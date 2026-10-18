import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "@/proxy";
import { buildPageCsp } from "@/lib/security-headers";

afterEach(() => vi.unstubAllEnvs());

function request(path: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  return new NextRequest(new URL(path, "https://jaded.example"), init);
}

describe("page CSP", () => {
  it("is strict in production", () => {
    const csp = buildPageCsp("abc", false);
    expect(csp).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("allows eval only in development", () => {
    expect(buildPageCsp("abc", true)).toContain("'unsafe-eval'");
  });
});

describe("proxy", () => {
  it("sets a fresh nonce CSP on each page response", () => {
    vi.stubEnv("NODE_ENV", "production");
    const a = proxy(request("/")).headers.get("content-security-policy");
    const b = proxy(request("/")).headers.get("content-security-policy");
    expect(a).toMatch(/'nonce-[A-Za-z0-9+/=]{20,}'/);
    expect(a).not.toBe(b);
  });

  it("redirects plain-HTTP page requests to HTTPS when deployed", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "https://jaded.example");
    const res = proxy(request("/dashboard?x=1", { headers: { "x-forwarded-proto": "http" } }));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://jaded.example/dashboard?x=1");
  });

  it("refuses plain-HTTP non-GET requests, such as webhooks, when deployed", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "https://jaded.example");
    const res = proxy(request("/api/github/webhook", { method: "POST", headers: { "x-forwarded-proto": "http" } }));
    expect(res.status).toBe(403);
  });

  it("serves a local production build over loopback HTTP", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "http://127.0.0.1:3100");
    const res = proxy(request("/", { headers: { "x-forwarded-proto": "http" } }));
    expect(res.status).toBe(200);
  });
});
