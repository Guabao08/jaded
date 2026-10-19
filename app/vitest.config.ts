import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globalSetup: ["tests/setup/global-db.ts"],
    setupFiles: ["tests/setup/env.ts"],
    // Database tests share one Postgres and reset tables, so run files one at a time.
    fileParallelism: false,
    hookTimeout: 60_000,
  },
});
