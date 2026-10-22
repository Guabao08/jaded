import { env } from "../env";
import { createFakeProvider } from "./fake";
import { createGeminiProvider } from "./gemini";
import type { TextProvider } from "./types";

export * from "./types";

/** The configured post writer, or null when no API key is set yet. Server-only. */
export function textProvider(): TextProvider | null {
  const e = env();
  if (e.AI_PROVIDER === "fake") return createFakeProvider();
  if (!e.GEMINI_API_KEY) return null;
  return createGeminiProvider({ apiKey: e.GEMINI_API_KEY, model: e.GEMINI_MODEL });
}

/** Monthly AI budget per workspace, in micro-dollars. */
export function monthlyCapMicro(): number {
  return Math.round(env().AI_MONTHLY_CAP_USD * 1_000_000);
}
