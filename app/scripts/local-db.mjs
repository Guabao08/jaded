// Runs a local Postgres for development: `npm run db:local`.
// Data lives in app/.data/pg (git-ignored). Stop with Ctrl+C.
import { resolve } from "node:path";
import { ensureLocalPostgres } from "./pg.mjs";

const port = Number(process.env.LOCAL_PG_PORT ?? 5433);
let db;
try {
  db = await ensureLocalPostgres({ dir: resolve(".data/pg"), port });
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
}
if (db.reused) {
  console.log(`The local database is already running on port ${port} (DATABASE_URL=${db.url}). Nothing to do.`);
  process.exit(0);
}
console.log(`Postgres is running. Set this in app/.env:\nDATABASE_URL=${db.url}\n\nPress Ctrl+C to stop.`);

const stop = async () => {
  await db.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
