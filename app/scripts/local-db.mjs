// Runs a local Postgres for development: `npm run db:local`.
// Data lives in app/.data/pg (git-ignored). Stop with Ctrl+C.
import { resolve } from "node:path";
import { startPostgres } from "./pg.mjs";

const port = Number(process.env.LOCAL_PG_PORT ?? 5433);
const db = await startPostgres({ dir: resolve(".data/pg"), port, quiet: true });
console.log(`Postgres is running. Set this in app/.env:\nDATABASE_URL=${db.url}\n\nPress Ctrl+C to stop.`);

const stop = async () => {
  await db.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
