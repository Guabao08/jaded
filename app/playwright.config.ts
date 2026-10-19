import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const MOCK_GITHUB_PORT = 3101;

// End-to-end tests run against a production build (`npm run build` first),
// through `npm run test:e2e`, which provides a throwaway DATABASE_URL.
// Sign-in goes to a fake GitHub (e2e/mock-github.mjs). Every value here is a
// throwaway generated per run, not a secret.
export default defineConfig({
  testDir: "e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  // The app's URL uses "localhost", not 127.0.0.1: Next.js's NextRequest rewrites
  // a 127.0.0.1 host to localhost, which would break Auth.js's same-origin checks.
  use: { baseURL: `http://localhost:${PORT}` },
  // CI installs Playwright's Chromium. Locally, PW_CHANNEL=msedge or chrome uses an installed browser.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel: process.env.PW_CHANNEL } }],
  webServer: [
    {
      command: "node e2e/mock-github.mjs",
      url: `http://127.0.0.1:${MOCK_GITHUB_PORT}/health`,
      env: { MOCK_GITHUB_PORT: String(MOCK_GITHUB_PORT) },
      reuseExistingServer: false,
    },
    {
      command: `npx next start -H 127.0.0.1 -p ${PORT}`,
      url: `http://127.0.0.1:${PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        APP_URL: `http://localhost:${PORT}`,
        DATABASE_URL: process.env.DATABASE_URL ?? "",
        ENCRYPTION_MASTER_KEYS: `e2e:${randomBytes(32).toString("base64")}`,
        ENCRYPTION_ACTIVE_KEY_VERSION: "e2e",
        AUTH_SECRET: randomBytes(32).toString("base64"),
        AUTH_GITHUB_ID: "e2e-client-id",
        AUTH_GITHUB_SECRET: "e2e-client-secret",
        AUTH_GITHUB_BASE_URL: `http://127.0.0.1:${MOCK_GITHUB_PORT}`,
        AUTH_ALLOWED_GITHUB_IDS: "1001,1002",
      },
    },
  ],
});
