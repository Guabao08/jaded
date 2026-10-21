// Runs the Playwright tests against a throwaway Postgres: `npm run test:e2e`.
// Expects a production build (`npm run build`). Extra arguments go to Playwright.
import { execSync, spawnSync } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startPostgres } from "./pg.mjs";

const pg = await startPostgres({ quiet: true, database: "jaded_e2e" });
const mediaDir = await mkdtemp(join(tmpdir(), "jaded-e2e-media-"));
let status = 1;
try {
  // Throwaway GitHub App credentials, shared by the app, the fake GitHub and the tests.
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const env = {
    ...process.env,
    DATABASE_URL: pg.url,
    E2E_WEBHOOK_SECRET: randomBytes(32).toString("hex"),
    E2E_MEDIA_DIR: mediaDir,
    E2E_APP_PRIVATE_KEY: Buffer.from(privateKey.export({ type: "pkcs1", format: "pem" })).toString("base64"),
    E2E_APP_PUBLIC_KEY: Buffer.from(publicKey.export({ type: "spki", format: "pem" })).toString("base64"),
  };
  execSync("npx prisma migrate deploy", { env, stdio: "inherit" });
  const cli = "node_modules/@playwright/test/cli.js";
  status = spawnSync(process.execPath, [cli, "test", ...process.argv.slice(2)], { env, stdio: "inherit" }).status ?? 1;
} finally {
  await pg.stop();
  await rm(mediaDir, { recursive: true, force: true });
}
process.exit(status);
