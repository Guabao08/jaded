import { randomBytes } from "node:crypto";
import { afterAll, inject } from "vitest";

// Throwaway values so code that validates the environment can run in tests.
process.env.APP_URL = "http://localhost:3000";
process.env.DATABASE_URL = inject("databaseUrl");
process.env.ENCRYPTION_MASTER_KEYS = `test:${randomBytes(32).toString("base64")}`;
process.env.ENCRYPTION_ACTIVE_KEY_VERSION = "test";
process.env.AUTH_SECRET = randomBytes(32).toString("base64");
process.env.AUTH_GITHUB_ID = "test-client-id";
process.env.AUTH_GITHUB_SECRET = "test-client-secret";
process.env.AUTH_ALLOWED_GITHUB_IDS = "1001,1002";
process.env.AI_PROVIDER = "fake";

// Close the database pool so the test run can exit cleanly.
afterAll(async () => {
  const { db } = await import("@/lib/db");
  await db().$disconnect();
});
