import { describe, expect, it } from "vitest";
import { createLogger, REDACTED, redact, redactString } from "@/lib/log";

function capture() {
  const lines: string[] = [];
  const logger = createLogger({
    level: "debug",
    sink: (line) => lines.push(line),
    now: () => new Date("2026-01-01T00:00:00Z"),
  });
  return { logger, lines, parsed: () => lines.map((l) => JSON.parse(l)) };
}

describe("redact", () => {
  it("replaces values under sensitive keys", () => {
    const out = redact({
      accessToken: "abc",
      refresh_token: "def",
      password: "hunter2",
      clientSecret: "s",
      webhookSecret: "w",
      apiKey: "k",
      "x-api-key": "k2",
      sessionId: "sess",
      privateKey: "pk",
      headers: {
        Authorization: "Bearer xyz",
        Cookie: "sid=1",
        "Set-Cookie": "sid=2",
        "X-Hub-Signature-256": "sha256=0",
      },
      databaseUrl: "postgres://u:p@h/db",
      body: { anything: "here" },
      rawBody: "{}",
      user: "alice",
      count: 3,
    }) as Record<string, unknown>;

    for (const key of [
      "accessToken",
      "refresh_token",
      "password",
      "clientSecret",
      "webhookSecret",
      "apiKey",
      "x-api-key",
      "sessionId",
      "privateKey",
      "databaseUrl",
      "body",
      "rawBody",
    ]) {
      expect(out[key], key).toBe(REDACTED);
    }
    expect(out.headers).toEqual({
      Authorization: REDACTED,
      Cookie: REDACTED,
      "Set-Cookie": REDACTED,
      "X-Hub-Signature-256": REDACTED,
    });
    expect(out.user).toBe("alice");
    expect(out.count).toBe(3);
  });

  it("removes token shapes from free text", () => {
    const samples = [
      "Authorization: Bearer abcdefghijklmnop.qrstuv",
      "github token ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      "fine-grained github_pat_11ABCDEFG0123456789_abcdefghijklmnop",
      "claude key sk-ant-api03-abcdefghijklmnopqrstuvwxyz",
      "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
      "aws AKIAABCDEFGHIJKLMNOP",
      "sig sha256=" + "a".repeat(64),
      "meta EAAGabcdefghijklmnopqrstuvwxyz0123",
      "google ya29.abcdefghijklmnopqrstuvwxyz0123",
      "stored jd1.v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBBBB.CCCC.DDDD",
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----",
    ];
    for (const sample of samples) {
      const out = redactString(sample);
      expect(out, sample).toContain(REDACTED);
      expect(out, sample).not.toMatch(/abcdefghijklmnop|AKIAABCD|aaaaaaaa|MIIEpA|BBBBBBBB|dozjgNry/);
    }
  });

  it("removes credentials from URLs", () => {
    expect(redactString("connecting to postgres://jaded:hunter2@db.internal:5432/jaded")).toBe(
      `connecting to postgres://${REDACTED}@db.internal:5432/jaded`,
    );
  });

  it("leaves ordinary text alone", () => {
    const text = "Shipped dark mode for the settings page (#42)";
    expect(redactString(text)).toBe(text);
  });

  it("handles errors, nesting, cycles, Headers and Maps", () => {
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic.self = cyclic;
    const error = new Error("failed with token ghp_abcdefghijklmnopqrstuvwxyz0123456789");
    const out = redact({
      error,
      cyclic,
      headers: new Headers({ authorization: "Bearer abcdefghijkl", accept: "json" }),
      map: new Map([["token", "t"]]),
      deep: { a: { b: { c: { secret: "s" } } } },
    }) as Record<string, any>;

    expect(out.error.message).not.toContain("ghp_");
    expect(out.error.stack).not.toContain("ghp_");
    expect(out.cyclic.self).toBe("[Circular]");
    expect(out.headers).toEqual({ authorization: REDACTED, accept: "json" });
    expect(out.map).toEqual({ token: REDACTED });
    expect(out.deep.a.b.c.secret).toBe(REDACTED);
  });

  it("does not mutate its input", () => {
    const input = { token: "t", nested: { password: "p" } };
    redact(input);
    expect(input).toEqual({ token: "t", nested: { password: "p" } });
  });
});

describe("logger", () => {
  it("writes one JSON object per line with level, time and message", () => {
    const { logger, parsed } = capture();
    logger.info("started", { port: 3000 });
    expect(parsed()).toEqual([{ port: 3000, time: "2026-01-01T00:00:00.000Z", level: "info", msg: "started" }]);
  });

  it("applies redaction to fields, bindings and messages", () => {
    const { logger, lines } = capture();
    logger.child({ requestId: "r1", cookie: "sid=abc" }).warn("retrying with Bearer abcdefghijklmnop", {
      headers: { authorization: "Bearer abcdefghijklmnop" },
      accessToken: "gho_abcdefghijklmnopqrstuvwxyz012345",
      note: "token ghp_abcdefghijklmnopqrstuvwxyz0123456789 leaked",
      body: { password: "hunter2" },
    });
    const line = lines.join("\n");
    expect(line).not.toMatch(/abcdefghijklmnop|sid=abc|hunter2|gho_|ghp_/);
    expect(JSON.parse(lines[0]).requestId).toBe("r1");
  });

  it("does not let fields overwrite level, time or message", () => {
    const { logger, parsed } = capture();
    logger.info("real", { level: "error", msg: "fake", time: "never" });
    expect(parsed()[0]).toMatchObject({ level: "info", msg: "real", time: "2026-01-01T00:00:00.000Z" });
  });

  it("drops messages below the configured level", () => {
    const lines: string[] = [];
    const logger = createLogger({ level: "warn", sink: (l) => lines.push(l) });
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    expect(lines.map((l) => JSON.parse(l).msg)).toEqual(["w", "e"]);
  });
});
