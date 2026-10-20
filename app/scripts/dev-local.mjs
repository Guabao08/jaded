// One command for local development: `npm run dev:local`.
// Starts the local Postgres (data in app/.data/pg), or reuses it if it is
// already running, applies migrations, then runs `next dev`. Ctrl+C stops
// both (a database that was already running is left running).
import { execSync, spawn } from "node:child_process";
import { resolve } from "node:path";
import { ensureLocalPostgres, portInUse } from "./pg.mjs";

const fail = (message) => {
  console.error(`\n${message}\n`);
  process.exit(1);
};

const appPort = Number(process.env.PORT ?? 3000);
if (await portInUse(appPort)) {
  fail(
    `Port ${appPort} is already in use, so Jaded may already be running (for example in the preview).\n` +
      `Open http://localhost:${appPort}, or stop the other one first (Ctrl+C in its terminal, or stop the preview).`,
  );
}

const pgPort = Number(process.env.LOCAL_PG_PORT ?? 5433);
let db;
try {
  db = await ensureLocalPostgres({ dir: resolve(".data/pg"), port: pgPort });
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
console.log(
  db.reused
    ? `Using the local database already running on port ${pgPort}.`
    : `Started the local database on port ${pgPort}.`,
);

const env = { ...process.env, DATABASE_URL: db.url };
try {
  execSync("npx prisma migrate deploy", { env, stdio: "inherit" });
} catch {
  await db.stop();
  fail("Applying database migrations failed (see above).");
}

const next = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "dev", "-p", String(appPort), ...process.argv.slice(2)],
  {
    env,
    stdio: "inherit",
  },
);

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
