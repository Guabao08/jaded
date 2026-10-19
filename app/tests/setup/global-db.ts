import { execSync } from "node:child_process";
import type { TestProject } from "vitest/node";
import { startPostgres } from "../../scripts/pg.mjs";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

// One throwaway Postgres for the whole test run, migrated to the current schema.
export default async function setup(project: TestProject) {
  const pg = await startPostgres({ quiet: true, database: "jaded_test" });
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: pg.url }, stdio: "ignore" });
  project.provide("databaseUrl", pg.url);
  return () => pg.stop();
}
