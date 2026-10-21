import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Live checks against real AI providers: `npm run check:ai`. Never part of `npm test` or CI.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["tests/live/**/*.live.ts"], environment: "node", testTimeout: 120_000 },
});
