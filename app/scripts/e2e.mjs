// Runs the Playwright tests against a throwaway Postgres: `npm run test:e2e`.
// Expects a production build (`npm run build`). Extra arguments go to Playwright.
import { execSync, spawnSync } from "node:child_process";
import { startPostgres } from "./pg.mjs";

const pg = await startPostgres({ quiet: true, database: "jaded_e2e" });
let status = 1;
try {
  const env = { ...process.env, DATABASE_URL: pg.url };
  execSync("npx prisma migrate deploy", { env, stdio: "inherit" });
  const cli = "node_modules/@playwright/test/cli.js";
  status = spawnSync(process.execPath, [cli, "test", ...process.argv.slice(2)], { env, stdio: "inherit" }).status ?? 1;
} finally {
  await pg.stop();
}
process.exit(status);
