import { PgBoss } from "pg-boss";
import { env } from "./env";
import { log } from "./log";

let boss: Promise<PgBoss> | undefined;

/**
 * Background job queue on Postgres. Started on first use, not at app start,
 * so the app runs without a database until a feature enqueues work.
 */
export function jobs(): Promise<PgBoss> {
  boss ??= (async () => {
    const instance = new PgBoss({ connectionString: env().DATABASE_URL });
    instance.on("error", (error) => log.error("job queue error", { error }));
    await instance.start();
    return instance;
  })();
  return boss;
}
