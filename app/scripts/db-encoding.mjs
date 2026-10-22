// Converts a local development database that was created with a non-UTF-8
// encoding (Windows used WIN1252 before this fix) into a UTF-8 one, keeping
// every row. The old database is kept, renamed, as a backup.
//
// Steps: create <name>_utf8, apply migrations, copy all rows table by table
// (parents before children), then swap the names. Local development only.
import { execSync } from "node:child_process";
import pg from "pg";
import { createUtf8Database } from "./pg.mjs";

function urlFor(base, database) {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

export async function databaseEncoding(adminUrl, name) {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const { rows } = await client.query(
      "SELECT pg_encoding_to_char(encoding) AS enc FROM pg_database WHERE datname = $1",
      [name],
    );
    return rows[0]?.enc ?? null;
  } finally {
    await client.end();
  }
}

/** Table names in an order where every table comes after the tables it references. */
async function copyOrder(client) {
  const { rows: tables } = await client.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'",
  );
  const { rows: fks } = await client.query(`
    SELECT c.relname AS child, p.relname AS parent
    FROM pg_constraint k
    JOIN pg_class c ON c.oid = k.conrelid
    JOIN pg_class p ON p.oid = k.confrelid
    WHERE k.contype = 'f' AND k.connamespace = 'public'::regnamespace`);
  const remaining = new Set(tables.map((t) => t.tablename));
  const order = [];
  while (remaining.size) {
    const ready = [...remaining].filter((t) =>
      fks.every((fk) => fk.child !== t || fk.parent === t || !remaining.has(fk.parent)),
    );
    if (!ready.length) throw new Error("Circular foreign keys; cannot order the copy");
    for (const t of ready.sort()) {
      order.push(t);
      remaining.delete(t);
    }
  }
  return order;
}

/**
 * If `name` is not UTF-8, converts it. Returns a short description of what
 * happened, or null if nothing was needed. Fails if other connections are open.
 */
export async function ensureUtf8(databaseUrl, { log = console.log } = {}) {
  const name = new URL(databaseUrl).pathname.slice(1);
  const adminUrl = urlFor(databaseUrl, "postgres");
  const encoding = await databaseEncoding(adminUrl, name);
  if (!encoding || encoding === "UTF8") return null;

  log(`The local database "${name}" uses ${encoding} text encoding. Converting it to UTF-8 (your data is kept)…`);
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const { rows } = await admin.query(
      "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [name],
    );
    if (rows[0].n > 0) {
      throw new Error(
        `Another program is connected to the "${name}" database (probably another Jaded window or the preview). Stop it and run this again.`,
      );
    }
    const target = `${name}_utf8`;
    await admin.query(`DROP DATABASE IF EXISTS "${target}"`);
    await createUtf8Database(adminUrl, target);
    execSync("npx prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: urlFor(databaseUrl, target) },
      stdio: "ignore",
    });

    const from = new pg.Client({ connectionString: databaseUrl });
    const to = new pg.Client({ connectionString: urlFor(databaseUrl, target) });
    await from.connect();
    await to.connect();
    let copied = 0;
    try {
      // Only tables that existed in the old database; migrations may have added new ones.
      for (const table of await copyOrder(from)) {
        const { rows: cols } = await from.query(
          "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position",
          [table],
        );
        const names = cols.map((c) => `"${c.column_name}"`).join(", ");
        const isJson = cols.map((c) => c.data_type === "json" || c.data_type === "jsonb");
        const { rows: data } = await from.query(`SELECT ${names} FROM "${table}"`);
        for (const row of data) {
          const values = cols.map((c, i) => {
            const v = row[c.column_name];
            return isJson[i] && v !== null ? JSON.stringify(v) : v;
          });
          const params = values.map((_, i) => `$${i + 1}`).join(", ");
          await to.query(`INSERT INTO "${table}" (${names}) VALUES (${params})`, values);
          copied++;
        }
      }
    } finally {
      await from.end();
      await to.end();
    }

    const backup = `${name}_${encoding.toLowerCase()}_backup`;
    await admin.query(`DROP DATABASE IF EXISTS "${backup}"`);
    await admin.query(`ALTER DATABASE "${name}" RENAME TO "${backup}"`);
    await admin.query(`ALTER DATABASE "${target}" RENAME TO "${name}"`);
    const summary = `Converted "${name}" to UTF-8 (${copied} rows copied). The old copy is kept as "${backup}".`;
    log(summary);
    return summary;
  } finally {
    await admin.end();
  }
}
