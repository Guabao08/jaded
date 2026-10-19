import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

// End-to-end tests run against a production build (`npm run build` first) with
// throwaway values. The master key below is random per run and is not a secret.
export default defineConfig({
  testDir: "e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://127.0.0.1:${PORT}` },
  // CI installs Playwright's Chromium. Locally, PW_CHANNEL=msedge or chrome uses an installed browser.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel: process.env.PW_CHANNEL } }],
  webServer: {
    command: `npx next start -H 127.0.0.1 -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      APP_URL: `http://127.0.0.1:${PORT}`,
      DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://jaded:jaded@127.0.0.1:5432/jaded_test",
      ENCRYPTION_MASTER_KEYS: `e2e:${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64")}`,
      ENCRYPTION_ACTIVE_KEY_VERSION: "e2e",
    },
  },
});
