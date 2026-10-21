import { execSync } from "node:child_process";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { databaseEncoding, ensureUtf8 } from "../../scripts/db-encoding.mjs";

const base = process.env.DATABASE_URL!;
const urlFor = (db: string) => Object.assign(new URL(base), { pathname: `/${db}` }).toString();

async function sql(db: string, text: string, params: unknown[] = []) {
  const client = new pg.Client({ connectionString: urlFor(db) });
  await client.connect();
  try {
    return (await client.query(text, params)).rows;
  } finally {
    await client.end();
  }
}

describe("local database encoding", () => {
  it("new local databases are UTF-8", async () => {
    expect(await databaseEncoding(urlFor("postgres"), new URL(base).pathname.slice(1))).toBe("UTF8");
  });

  it("converts an old WIN1252 database to UTF-8 without losing rows", async () => {
    await sql("postgres", 'DROP DATABASE IF EXISTS "enc_old"');
    await sql("postgres", 'DROP DATABASE IF EXISTS "enc_old_win1252_backup"');
    await sql(
      "postgres",
      `CREATE DATABASE "enc_old" ENCODING 'WIN1252' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`,
    );
    execSync("npx prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: urlFor("enc_old") },
      stdio: "ignore",
    });

    await sql(
      "enc_old",
      `INSERT INTO "User" (id, "githubId", "githubLogin", name, "updatedAt") VALUES ('u1', '1001', 'alice', 'Zoë Café', now())`,
    );
    await sql("enc_old", `INSERT INTO "Workspace" (id, name, "updatedAt") VALUES ('w1', 'alice''s workspace', now())`);
    await sql(
      "enc_old",
      `INSERT INTO "Membership" (id, "userId", "workspaceId", role) VALUES ('m1', 'u1', 'w1', 'OWNER')`,
    );
    await sql(
      "enc_old",
      `INSERT INTO "AuditLog" (id, action, "actorUserId", metadata) VALUES ('a1', 'auth.sign_in', 'u1', $1)`,
      [JSON.stringify({ provider: "github", list: [1, 2] })],
    );
    await expect(sql("enc_old", `UPDATE "User" SET name = 'Zoë → 🚀' WHERE id = 'u1'`)).rejects.toThrow();

    const summary = await ensureUtf8(urlFor("enc_old"), { log: () => {} });
    expect(summary).toMatch(/4 rows copied/);
    expect(await databaseEncoding(urlFor("postgres"), "enc_old")).toBe("UTF8");
    expect(await databaseEncoding(urlFor("postgres"), "enc_old_win1252_backup")).toBe("WIN1252");

    expect((await sql("enc_old", 'SELECT name FROM "User"'))[0].name).toBe("Zoë Café");
    expect((await sql("enc_old", 'SELECT metadata FROM "AuditLog"'))[0].metadata).toEqual({
      provider: "github",
      list: [1, 2],
    });
    expect(await sql("enc_old", 'SELECT role FROM "Membership"')).toEqual([{ role: "OWNER" }]);
    await sql("enc_old", `UPDATE "User" SET name = 'Zoë → 🚀' WHERE id = 'u1'`);
    expect((await sql("enc_old", 'SELECT name FROM "User"'))[0].name).toBe("Zoë → 🚀");

    expect(await ensureUtf8(urlFor("enc_old"), { log: () => {} })).toBeNull(); // nothing to do the second time
  }, 120_000);
});
