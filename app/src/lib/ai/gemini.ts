import {
  AiNotConfiguredError,
  AiUnavailableError,
  RateLimitedError,
  type PostWritingInput,
  type TextProvider,
  type TextResult,
} from "./types";
import { log } from "../log";

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

export interface GeminiOptions {
  apiKey: string;
  model: string;
  /** A second free-tier model to use when the first stays unavailable or rate-limited. */
  fallbackModel?: string | null;
  fetchImpl?: typeof fetch;
  /** Per-request time limit. */
  timeoutMs?: number;
  /** Tries per model for temporary failures (timeouts, 5xx). */
  attemptsPerModel?: number;
  sleep?: (ms: number) => Promise<void>;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createGeminiProvider(opts: GeminiOptions): TextProvider {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? wait;
  const attempts = opts.attemptsPerModel ?? 3;
  const models = [opts.model, ...(opts.fallbackModel && opts.fallbackModel !== opts.model ? [opts.fallbackModel] : [])];

  async function callOnce(model: string, prompt: { system: string; user: string }): Promise<TextResult> {
    let response: Response;
    try {
      response = await fetchImpl(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
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
            // Gemini 3 models "think" before answering; at the default level a post
            // can take over a minute. Short social copy doesn't need it.
            ...(/^gemini-3/.test(model) && !/lite/.test(model) ? { thinkingConfig: { thinkingLevel: "low" } } : {}),
          },
        }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 45_000),
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
      model,
      raw: text,
      usage: {
        inputTokens: usage.promptTokenCount ?? 0,
        // Thinking tokens are billed as output.
        outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
      },
    };
  }

  return {
    name: "gemini",
    model: opts.model,
    /**
     * Tries the main model a few times on temporary failures (timeouts, 500/503
     * "overloaded"), backing off between tries; then the fallback model. A rate
     * limit moves straight to the fallback, which has its own free-tier quota.
     * Key and model errors are not retried.
     */
    async writePosts(prompt, _input: PostWritingInput): Promise<TextResult> {
      let lastError: Error = new AiUnavailableError("Gemini is unavailable.");
      for (const [index, model] of models.entries()) {
        for (let attempt = 1; attempt <= attempts; attempt++) {
          try {
            const result = await callOnce(model, prompt);
            log.info("gemini reply", { model, fallback: index > 0, attempt });
            return result;
          } catch (error) {
            if (error instanceof AiNotConfiguredError) throw error;
            lastError = error as Error;
            if (error instanceof RateLimitedError) break; // try the fallback model
            log.warn("gemini temporarily unavailable", { model, attempt, reason: (error as Error).message });
            if (attempt < attempts) await sleep(1000 * 2 ** (attempt - 1));
          }
        }
        if (index + 1 < models.length)
          log.warn("gemini switching to fallback model", { from: model, to: models[index + 1] });
      }
      throw lastError;
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
