import { generateKeyPairSync, createVerify } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { appJwt, createGitHubClient, INSTALLATION_PERMISSIONS } from "@/lib/github/client";
import {
  hasValidSignature,
  MAX_WEBHOOK_BYTES,
  normalizePush,
  PayloadTooLargeError,
  readLimitedBody,
  signBody,
} from "@/lib/github/webhook";
import { pushPayload } from "../fixtures/github";

const secret = "s".repeat(40);

describe("webhook signature", () => {
  const body = Buffer.from(JSON.stringify({ hello: "world" }));

  it("accepts the correct HMAC-SHA256", () => {
    expect(hasValidSignature(secret, body, signBody(secret, body))).toBe(true);
  });

  it("rejects a wrong, malformed, missing or differently-keyed signature", () => {
    const good = signBody(secret, body);
    const flipped = good.slice(0, -1) + (good.endsWith("0") ? "1" : "0");
    expect(hasValidSignature(secret, body, flipped)).toBe(false);
    expect(hasValidSignature(secret, body, good.replace("sha256=", "sha1="))).toBe(false);
    expect(hasValidSignature(secret, body, "sha256=xyz")).toBe(false);
    expect(hasValidSignature(secret, body, null)).toBe(false);
    expect(hasValidSignature(secret, body, signBody("other".repeat(10), body))).toBe(false);
    expect(hasValidSignature(secret, Buffer.from(body.toString() + " "), good)).toBe(false);
    expect(hasValidSignature("", body, good)).toBe(false);
  });
});

describe("readLimitedBody", () => {
  it("reads a body under the limit", async () => {
    const request = new Request("https://x/", { method: "POST", body: "abc" });
    expect((await readLimitedBody(request, 10)).toString()).toBe("abc");
  });

  it("rejects by declared length and by actual size", async () => {
    const declared = new Request("https://x/", {
      method: "POST",
      body: "a",
      headers: { "content-length": String(MAX_WEBHOOK_BYTES + 1) },
    });
    await expect(readLimitedBody(declared)).rejects.toBeInstanceOf(PayloadTooLargeError);
    const big = new Request("https://x/", { method: "POST", body: "a".repeat(11) });
    await expect(readLimitedBody(big, 10)).rejects.toBeInstanceOf(PayloadTooLargeError);
  });
});

describe("normalizePush", () => {
  it("keeps what Jaded needs and drops author emails", () => {
    const push = normalizePush(pushPayload())!;
    expect(push).toMatchObject({
      githubRepoId: "777",
      fullName: "alice/demo",
      ref: "refs/heads/main",
      pusherLogin: "alice",
      compareUrl: "https://github.com/alice/demo/compare/aaa...bbb",
    });
    expect(push.commits[0]).toMatchObject({
      sha: "b".repeat(40),
      title: "Add dark mode",
      url: `https://github.com/alice/demo/commit/${"b".repeat(40)}`,
      authorLogin: "alice",
    });
    expect(JSON.stringify(push)).not.toContain("@example.com");
  });

  it("caps commits and text length, and refuses non-https links", () => {
    const payload = pushPayload({
      compare: "javascript:alert(1)",
      commits: Array.from({ length: 30 }, (_, i) => ({
        id: i.toString(16).padStart(40, "0"),
        message: "x".repeat(5000),
        author: { email: "a@example.com" },
      })),
    });
    const push = normalizePush(payload)!;
    expect(push.commits).toHaveLength(20);
    expect(push.commits[0].message.length).toBe(2000);
    expect(push.compareUrl).toBeNull();
  });

  it("returns null without a repository", () => {
    expect(normalizePush({})).toBeNull();
  });
});

describe("GitHub App client", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  const app = {
    appId: "123",
    slug: "jaded",
    privateKey: pem,
    clientId: "cid",
    clientSecret: "cs",
    webhookSecret: secret,
  };

  it("signs an RS256 app JWT that expires within 10 minutes", () => {
    const now = Date.UTC(2026, 0, 1);
    const [h, p, s] = appJwt(app, now).split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(p, "base64url").toString());
    expect(claims.iss).toBe("123");
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(600);
    const ok = createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(s, "base64url"));
    expect(ok).toBe(true);
  });

  it("requests installation tokens with read-only permissions only", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ token: "ghs_x" }));
    const client = createGitHubClient(app, { web: "https://github.com", api: "https://api.github.com" }, fetchImpl);
    expect(await client.installationToken("42", [777])).toBe("ghs_x");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.github.com/app/installations/42/access_tokens");
    expect(JSON.parse(String(init.body))).toEqual({ permissions: INSTALLATION_PERMISSIONS, repository_ids: [777] });
    expect(Object.values(INSTALLATION_PERMISSIONS).every((p) => p === "read")).toBe(true);
  });
});
