// Starts a real Postgres server from the embedded-postgres npm binaries, for
// local development and tests. Not used in staging or production, which use
// the host's managed Postgres.
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

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

export function localDatabaseUrl(port, database = "jaded") {
  return `postgresql://${USER}:${PASSWORD}@127.0.0.1:${port}/${database}`;
}

/** True if something accepts TCP connections on 127.0.0.1:port. */
export function portInUse(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

/** True if we can log in to the database at `url`. */
export async function canConnect(url) {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * For local development: reuses the local Postgres if one is already running
 * on `port` (for example from the preview or `npm run db:local`), otherwise
 * starts it. `stop` only stops a server this call started.
 */
export async function ensureLocalPostgres({ dir, port }) {
  const url = localDatabaseUrl(port);
  if (await portInUse(port)) {
    if (await canConnect(url)) return { url, reused: true, stop: async () => {} };
    throw new Error(
      `Port ${port} is already in use by something that isn't Jaded's local database. ` +
        `Stop it, or set LOCAL_PG_PORT to another port (and use that port in DATABASE_URL in app/.env).`,
    );
  }
  try {
    return { ...(await startPostgres({ dir, port, quiet: true })), reused: false };
  } catch (error) {
    throw new Error(
      `The local database didn't start${error instanceof Error ? `: ${error.message}` : ""}. ` +
        `If the computer restarted or crashed while it was running, delete app/.data/pg/postmaster.pid and try again.`,
    );
  }
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
    url: localDatabaseUrl(port, database),
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
