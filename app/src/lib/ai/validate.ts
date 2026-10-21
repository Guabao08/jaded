import { redactString } from "../log";
import { generatedPostsSchema, type GeneratedPosts, type PostWritingInput } from "./types";

/**
 * Checks the model's reply before anything is saved. A reply that fails is
 * never stored: generation retries once, then the Update is marked failed.
 * These checks are a second line of defence against prompt injection; the
 * prompt itself is the first.
 */

export class AiOutputError extends Error {
  constructor(readonly problems: string[]) {
    super(`AI output failed checks: ${problems.join("; ")}`);
    this.name = "AiOutputError";
  }
}

const URL_LIKE = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|io|app|dev|ly|co|xyz|me)\b(?:\/\S*)?/i;
const EMAIL = /\b[^\s@]+@[^\s@]+\.[a-z]{2,}\b/i;
const INJECTION_MARKERS = [
  /ignore (?:all |any |the )?(?:previous|prior|above|earlier) (?:instructions|rules)/i,
  /\bsystem prompt\b/i,
  /\buntrusted_data\b/i,
  /\bas an ai\b/i,
];

export function validateGeneratedPosts(raw: unknown, input: PostWritingInput): GeneratedPosts {
  const parsed = generatedPostsSchema.safeParse(typeof raw === "string" ? tryJson(raw) : raw);
  if (!parsed.success) throw new AiOutputError(["reply did not match the expected format"]);
  const result = parsed.data;
  const problems: string[] = [];

  const platforms = result.posts.map((p) => p.platform);
  for (const platform of input.platforms) {
    if (!platforms.includes(platform)) problems.push(`missing ${platform} post`);
  }
  if (new Set(platforms).size !== platforms.length) problems.push("duplicate platform");

  const avoid = input.voice.wordsToAvoid.map((w) => w.toLowerCase()).filter(Boolean);
  const texts: Array<[string, string]> = [
    ...result.highlights.map((h, i): [string, string] => [`highlight ${i + 1}`, h]),
    ...result.posts.flatMap((p): Array<[string, string]> => [
      [`${p.platform} headline`, p.headline],
      [`${p.platform} caption`, p.caption],
      [`${p.platform} alt text`, p.altText],
      [`${p.platform} hashtags`, p.hashtags.join(" ")],
    ]),
  ];
  for (const [where, text] of texts) {
    if (URL_LIKE.test(text)) problems.push(`${where} contains a link`);
    if (EMAIL.test(text)) problems.push(`${where} contains an email address`);
    if (INJECTION_MARKERS.some((m) => m.test(text))) problems.push(`${where} echoes instructions`);
    if (redactString(text) !== text) problems.push(`${where} contains something that looks like a secret`);
    const lower = text.toLowerCase();
    for (const word of avoid) if (lower.includes(word)) problems.push(`${where} uses an avoided word`);
  }
  for (const p of result.posts) {
    if (p.headline.length > 60) problems.push(`${p.platform} headline is too long`);
    if (p.platform === "INSTAGRAM" && p.caption.length > 1200) problems.push("INSTAGRAM caption is too long");
    if (p.platform === "FACEBOOK" && p.caption.length > 800) problems.push("FACEBOOK caption is too long");
  }

  if (problems.length) throw new AiOutputError([...new Set(problems)]);
  return { ...result, posts: result.posts.filter((p) => input.platforms.includes(p.platform)) };
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return null;
  }
}
