// One command for local development: `npm run dev:local`.
// Starts the local Postgres (data in app/.data/pg), applies migrations, then
// runs `next dev`. Ctrl+C stops both.
import { execSync, spawn } from "node:child_process";
import { resolve } from "node:path";
import { startPostgres } from "./pg.mjs";

const port = Number(process.env.LOCAL_PG_PORT ?? 5433);
const db = await startPostgres({ dir: resolve(".data/pg"), port, quiet: true });
// The URL printed by `npm run db:local`; it matches the DATABASE_URL in .env.example.
const env = { ...process.env, DATABASE_URL: db.url };
console.log(`Postgres is running on port ${port}.`);
execSync("npx prisma migrate deploy", { env, stdio: "inherit" });

const next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", ...process.argv.slice(2)], {
  env,
  stdio: "inherit",
});

let stopping = false;
const stop = async (code = 0) => {
  if (stopping) return;
  stopping = true;
  next.kill();
  await db.stop();
  process.exit(code);
};
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
next.on("exit", (code) => stop(code ?? 0));
