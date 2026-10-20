import { PgBoss } from "pg-boss";
import { env } from "./env";
import { log } from "./log";

export const QUEUES = {
  githubEvent: "github-event",
} as const;

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
    for (const name of Object.values(QUEUES)) await instance.createQueue(name);
    return instance;
  })().catch((error) => {
    boss = undefined; // Let the next call retry.
    throw error;
  });
  return boss;
}

export async function enqueue(name: string, data: object, options: { singletonKey?: string } = {}): Promise<void> {
  const queue = await jobs();
  await queue.send(name, data, { retryLimit: 5, retryDelay: 30, retryBackoff: true, ...options });
}
