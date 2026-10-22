import type { PrismaClient } from "@/generated/prisma/client";
import type { TokenUsage } from "./types";

/**
 * AI cost tracking and the per-workspace monthly cap. Costs are estimated at
 * the provider's paid list prices even when the free tier is used, so the cap
 * still means something if billing is turned on later.
 *
 * Prices are US dollars per 1M tokens, which makes tokens × price exactly
 * millionths of a dollar ("micro-dollars").
 */
export const PRICES_PER_MILLION: Record<string, { input: number; output: number }> = {
  // Google list prices through 2026-12-31 (ai.google.dev/gemini-api/docs/pricing, checked 2026-10-21).
  "gemini-3.8-flash": { input: 0.75, output: 3.75 },
  "gemini-3.6-flash": { input: 0.75, output: 3.75 },
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5 },
  "gemini-3.1-flash-lite": { input: 0.25, output: 1.5 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
  "fake-writer-1": { input: 0.75, output: 3.75 },
};
// Unknown models are priced like the most expensive one we know, to stay on the safe side.
const FALLBACK = { input: 2, output: 10 };

export function estimateCostMicro(model: string, usage: TokenUsage): number {
  const price = PRICES_PER_MILLION[model] ?? FALLBACK;
  return Math.ceil(usage.inputTokens * price.input + usage.outputTokens * price.output);
}

export function usageMonth(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

export async function monthlySpendMicro(
  db: () => PrismaClient,
  workspaceId: string,
  now = new Date(),
): Promise<number> {
  const result = await db().aiUsage.aggregate({
    where: { workspaceId, month: usageMonth(now) },
    _sum: { estimatedCostMicro: true },
  });
  return result._sum.estimatedCostMicro ?? 0;
}

export function formatUsd(micro: number): string {
  return `$${(micro / 1_000_000).toFixed(micro < 10_000 ? 4 : 2)}`;
}
