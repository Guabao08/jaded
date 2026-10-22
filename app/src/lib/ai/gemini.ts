import {
  AiNotConfiguredError,
  AiUnavailableError,
  RateLimitedError,
  type PostWritingInput,
  type TextProvider,
  type TextResult,
} from "./types";

/**
 * Google Gemini (generateContent REST API). The key is sent only from the
 * server, in a header, and never reaches the browser or logs.
 */

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

// JSON schema for the reply (Gemini's OpenAPI-style subset).
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    highlights: { type: "ARRAY", items: { type: "STRING" } },
    posts: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          platform: { type: "STRING", enum: ["INSTAGRAM", "FACEBOOK"] },
          headline: { type: "STRING" },
          caption: { type: "STRING" },
          hashtags: { type: "ARRAY", items: { type: "STRING" } },
          altText: { type: "STRING" },
        },
        required: ["platform", "headline", "caption", "hashtags", "altText"],
      },
    },
  },
  required: ["highlights", "posts"],
};

export function createGeminiProvider(opts: { apiKey: string; model: string; fetchImpl?: typeof fetch }): TextProvider {
  const fetchImpl = opts.fetchImpl ?? fetch;
  return {
    name: "gemini",
    model: opts.model,
    async writePosts(prompt, _input: PostWritingInput): Promise<TextResult> {
      let response: Response;
      try {
        response = await fetchImpl(`${ENDPOINT}/${encodeURIComponent(opts.model)}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": opts.apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: prompt.system }] },
            contents: [{ role: "user", parts: [{ text: prompt.user }] }],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 4096,
              responseMimeType: "application/json",
              responseSchema: RESPONSE_SCHEMA,
            },
          }),
          signal: AbortSignal.timeout(60_000),
        });
      } catch {
        throw new AiUnavailableError("Couldn't reach Gemini (network error or timeout).");
      }

      const body = (await response.json().catch(() => ({}))) as GeminiResponse;
      if (!response.ok) throw geminiError(response.status, body);

      const parts = body.candidates?.[0]?.content?.parts ?? [];
      const text = parts
        .filter((p) => !p.thought && typeof p.text === "string")
        .map((p) => p.text)
        .join("");
      if (!text) {
        const reason = body.candidates?.[0]?.finishReason ?? body.promptFeedback?.blockReason ?? "empty reply";
        throw new AiUnavailableError(`Gemini returned no text (${reason}).`);
      }
      const usage = body.usageMetadata ?? {};
      return {
        provider: "gemini",
        model: opts.model,
        raw: text,
        usage: {
          inputTokens: usage.promptTokenCount ?? 0,
          // Thinking tokens are billed as output.
          outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
        },
      };
    },
  };
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  error?: {
    code?: number;
    status?: string;
    message?: string;
    details?: Array<{ "@type"?: string; retryDelay?: string; violations?: Array<{ quotaId?: string }> }>;
  };
}

/** Maps Gemini's errors to ours. Error messages never include the key or the request. */
export function geminiError(status: number, body: GeminiResponse): Error {
  const err = body.error ?? {};
  if (status === 429 || err.status === "RESOURCE_EXHAUSTED") {
    const retry = err.details?.find((d) => d["@type"]?.endsWith("RetryInfo"))?.retryDelay;
    const seconds = retry ? Math.ceil(parseFloat(retry)) : 60;
    const quotaIds = (err.details ?? []).flatMap((d) => d.violations ?? []).map((v) => v.quotaId ?? "");
    const daily = quotaIds.some((id) => /PerDay/i.test(id));
    return new RateLimitedError(Number.isFinite(seconds) && seconds > 0 ? seconds : 60, daily);
  }
  if (status === 400 && /API key/i.test(err.message ?? "")) {
    return new AiNotConfiguredError("Gemini rejected the API key. Check GEMINI_API_KEY in app/.env.");
  }
  if (status === 401 || status === 403) {
    return new AiNotConfiguredError(
      "Gemini refused the request (the API key may be wrong or lack access to this model).",
    );
  }
  if (status === 404) {
    return new AiNotConfiguredError("Gemini doesn't recognise the model name. Check GEMINI_MODEL in app/.env.");
  }
  return new AiUnavailableError(`Gemini returned an error (${status}${err.status ? ` ${err.status}` : ""}).`);
}
