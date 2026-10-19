// Starts a real Postgres server from the embedded-postgres npm binaries, for
// local development and tests. Not used in staging or production, which use
// the host's managed Postgres.
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";

// Local-only credentials. The server listens on 127.0.0.1 only.
const USER = "jaded";
const PASSWORD = "jaded-local";

export async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * @param {{ dir?: string, port?: number, database?: string, quiet?: boolean }} options
 *   Without `dir`, a throwaway server in a temp folder that is deleted on stop.
 */
export async function startPostgres(options = {}) {
  const persistent = Boolean(options.dir);
  const dir = options.dir ?? (await mkdtemp(join(tmpdir(), "jaded-pg-")));
  const port = options.port ?? (await freePort());
  const database = options.database ?? "jaded";
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    port,
    user: USER,
    password: PASSWORD,
    persistent,
    postgresFlags: ["-c", "listen_addresses=127.0.0.1"],
    onLog: options.quiet ? () => {} : (message) => process.stdout.write(String(message)),
    onError: (error) => process.stderr.write(String(error) + "\n"),
  });
  if (!persistent || !existsSync(join(dir, "PG_VERSION"))) await pg.initialise();
  await pg.start();
  try {
    await pg.createDatabase(database);
  } catch {
    // Already exists.
  }
  return {
    url: `postgresql://${USER}:${PASSWORD}@127.0.0.1:${port}/${database}`,
    stop: async () => {
      try {
        await pg.stop();
      } catch (error) {
        // Windows can briefly lock the temp folder while Postgres exits; the
        // server is already stopped, so only the cleanup is skipped.
        if (error?.code !== "EBUSY") throw error;
      }
    },
  };
}
