import { describe, expect, it } from "vitest";
import { generateMasterKey } from "@/lib/crypto";
import { EnvError, parseEnv } from "@/lib/env";

const key = generateMasterKey();
const valid = {
  NODE_ENV: "production",
  APP_URL: "https://jaded.example",
  DATABASE_URL: "postgresql://user:pass@localhost:5432/jaded",
  ENCRYPTION_MASTER_KEYS: `v1:${key}`,
  ENCRYPTION_ACTIVE_KEY_VERSION: "v1",
  AUTH_SECRET: "a".repeat(32),
  AUTH_GITHUB_ID: "client-id",
  AUTH_GITHUB_SECRET: "client-secret",
  AUTH_ALLOWED_GITHUB_IDS: "1001, 1002",
};

function problems(source: Record<string, string | undefined>): string[] {
  try {
    parseEnv(source);
  } catch (error) {
    if (error instanceof EnvError) return error.problems;
    throw error;
  }
  return [];
}

describe("parseEnv", () => {
  it("accepts a complete environment and applies defaults", () => {
    const env = parseEnv(valid);
    expect(env.APP_URL).toBe("https://jaded.example");
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.AUTH_ALLOWED_GITHUB_IDS).toEqual(["1001", "1002"]);
  });

  it.each([
    "APP_URL",
    "DATABASE_URL",
    "ENCRYPTION_MASTER_KEYS",
    "ENCRYPTION_ACTIVE_KEY_VERSION",
    "AUTH_SECRET",
    "AUTH_GITHUB_ID",
    "AUTH_GITHUB_SECRET",
    "AUTH_ALLOWED_GITHUB_IDS",
  ])("refuses when %s is missing or empty", (name) => {
    expect(problems({ ...valid, [name]: undefined }).join("\n")).toContain(`${name} is required`);
    expect(problems({ ...valid, [name]: "" }).join("\n")).toContain(`${name} is required`);
  });

  it("requires https in production", () => {
    expect(problems({ ...valid, APP_URL: "http://jaded.example" }).join("\n")).toContain("https");
    expect(problems({ ...valid, NODE_ENV: "development", APP_URL: "http://jaded.example" })).toEqual([]);
    expect(problems({ ...valid, APP_URL: "http://localhost:3100" })).toEqual([]);
    expect(problems({ ...valid, APP_URL: "http://127.0.0.1:3100" }).join("\n")).toContain("localhost");
    expect(problems({ ...valid, APP_URL: "http://localhost.evil.example" }).join("\n")).toContain("https");
  });

  it("rejects a malformed keyring", () => {
    expect(problems({ ...valid, ENCRYPTION_MASTER_KEYS: "v1:tooshort" }).join("\n")).toContain(
      "ENCRYPTION_MASTER_KEYS",
    );
    expect(problems({ ...valid, ENCRYPTION_ACTIVE_KEY_VERSION: "v9" }).join("\n")).toContain("not in the keyring");
  });

  it("rejects a non-postgres database URL", () => {
    expect(problems({ ...valid, DATABASE_URL: "mysql://x" }).join("\n")).toContain("DATABASE_URL");
  });

  it("never includes secret values in its errors", () => {
    const message = problems({ ...valid, APP_URL: undefined, ENCRYPTION_ACTIVE_KEY_VERSION: "v9" }).join("\n");
    expect(message).not.toContain(key);
    expect(message).not.toContain("pass@");
  });
});
