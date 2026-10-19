import { describe, expect, it, vi } from "vitest";
import { buildAuthConfig, isAllowedGitHubId, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/auth/config";
import { readCookie } from "@/lib/auth/rotate";
import { db } from "@/lib/db";
import { parseEnv } from "@/lib/env";
import { createRateLimiter } from "@/lib/rate-limit";

const env = parseEnv(process.env);

describe("session cookie", () => {
  const config = buildAuthConfig(env, { db, audit: async () => {} });

  it("is httpOnly, Secure, SameSite=Lax and host-wide", () => {
    expect(config.cookies?.sessionToken).toEqual({
      name: SESSION_COOKIE,
      options: { httpOnly: true, secure: true, sameSite: "lax", path: "/" },
    });
    expect(SESSION_COOKIE.startsWith("__Secure-")).toBe(true);
    expect(config.useSecureCookies).toBe(true);
  });

  it("uses database sessions that expire", () => {
    expect(config.session).toMatchObject({ strategy: "database", maxAge: SESSION_MAX_AGE_SECONDS });
    expect(SESSION_MAX_AGE_SECONDS).toBeLessThanOrEqual(30 * 24 * 60 * 60);
  });
});

describe("sign-in allowlist", () => {
  it("allows only listed numeric GitHub IDs", () => {
    expect(isAllowedGitHubId(env, "1001")).toBe(true);
    expect(isAllowedGitHubId(env, "1002")).toBe(true);
    expect(isAllowedGitHubId(env, "2001")).toBe(false);
    expect(isAllowedGitHubId(env, undefined)).toBe(false);
  });

  it("denies and audits anyone else", async () => {
    const audit = vi.fn(async () => {});
    const config = buildAuthConfig(env, { db, audit });
    const signIn = config.callbacks!.signIn!;
    const account = { provider: "github", type: "oauth" as const, providerAccountId: "2001" };

    expect(await signIn({ account, profile: { login: "mallory" }, user: { id: "x" } } as never)).toBe(false);
    expect(audit).toHaveBeenCalledWith({
      action: "auth.sign_in_denied",
      metadata: { provider: "github", githubId: "2001", githubLogin: "mallory" },
    });

    const allowed = { ...account, providerAccountId: "1001" };
    expect(await signIn({ account: allowed, profile: { login: "alice" }, user: { id: "x" } } as never)).toBe(true);
  });

  it("rejects a malformed allowlist at startup", () => {
    expect(() => parseEnv({ ...process.env, AUTH_ALLOWED_GITHUB_IDS: "alice" })).toThrow(/AUTH_ALLOWED_GITHUB_IDS/);
  });

  it("allows the fake-GitHub override only for local testing", () => {
    expect(() =>
      parseEnv({ ...process.env, APP_URL: "https://jaded.example", AUTH_GITHUB_BASE_URL: "http://127.0.0.1:3101" }),
    ).toThrow(/AUTH_GITHUB_BASE_URL/);
    expect(() => parseEnv({ ...process.env, AUTH_GITHUB_BASE_URL: "https://evil.example" })).toThrow(
      /AUTH_GITHUB_BASE_URL/,
    );
    expect(parseEnv({ ...process.env, AUTH_GITHUB_BASE_URL: "http://127.0.0.1:3101" }).AUTH_GITHUB_BASE_URL).toBe(
      "http://127.0.0.1:3101",
    );
  });
});

describe("readCookie", () => {
  it("finds a cookie by exact name", () => {
    expect(readCookie(`x=1; ${SESSION_COOKIE}=abc; y=2`, SESSION_COOKIE)).toBe("abc");
    expect(readCookie(`x${SESSION_COOKIE}=abc`, SESSION_COOKIE)).toBeUndefined();
    expect(readCookie(null, SESSION_COOKIE)).toBeUndefined();
  });
});

describe("rate limiter", () => {
  it("blocks after the limit within a window and resets after it", () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000 });
    expect([1, 2, 3, 4].map(() => limiter.hit("ip", 0))).toEqual([true, true, true, false]);
    expect(limiter.hit("other", 0)).toBe(true);
    expect(limiter.hit("ip", 1000)).toBe(true);
  });
});
