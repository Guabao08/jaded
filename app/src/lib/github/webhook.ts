import { createHmac, timingSafeEqual } from "node:crypto";
import { cleanText } from "../text";

// GitHub payloads are untyped JSON; every field used is checked or coerced below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GitHubPayload = Record<string, any>;

// Ported from ShipBrief's server.js: signature check, size cap, push parsing.

export const MAX_WEBHOOK_BYTES = 1_000_000;
const MAX_COMMITS = 20;

export class PayloadTooLargeError extends Error {}

/** HMAC-SHA256 check of the raw body against X-Hub-Signature-256, in constant time. */
export function hasValidSignature(secret: string, rawBody: Buffer, header: string | null): boolean {
  if (!secret || typeof header !== "string" || !/^sha256=[a-f0-9]{64}$/i.test(header)) return false;
  const supplied = Buffer.from(header.slice("sha256=".length), "hex");
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function signBody(secret: string, rawBody: Buffer | string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

/** Reads the request body, refusing anything over `limit` bytes without buffering it all. */
export async function readLimitedBody(request: Request, limit = MAX_WEBHOOK_BYTES): Promise<Buffer> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > limit) throw new PayloadTooLargeError();
  if (!request.body) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new PayloadTooLargeError();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

const text = cleanText;

function httpsUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export interface PushCommit {
  sha: string;
  title: string;
  message: string;
  url: string | null;
  timestamp: string | null;
  authorLogin: string | null;
}

export interface NormalizedPush {
  githubRepoId: string;
  fullName: string;
  ref: string;
  beforeSha: string;
  afterSha: string;
  pusherLogin: string | null;
  compareUrl: string | null;
  commits: PushCommit[];
  pushedAt: string;
  deleted: boolean;
}

/**
 * Keeps only what Jaded needs from a push payload. Commit author emails and
 * the rest of the payload are dropped here, before anything is stored.
 * Commit text is untrusted user content.
 */
export function normalizePush(payload: GitHubPayload): NormalizedPush | null {
  const repo = payload?.repository;
  if (!repo || repo.id === undefined) return null;
  const repoUrl = httpsUrl(repo.html_url);
  const commits = (Array.isArray(payload.commits) ? payload.commits.slice(-MAX_COMMITS) : [])
    .map((c: GitHubPayload): PushCommit => {
      const sha = text(c.id, 64);
      const message = text(c.message, 2000);
      return {
        sha,
        message,
        title: text(message.split("\n")[0], 200),
        url: repoUrl && /^[0-9a-f]{7,64}$/i.test(sha) ? `${repoUrl.replace(/\/$/, "")}/commit/${sha}` : null,
        timestamp: typeof c.timestamp === "string" ? text(c.timestamp, 40) : null,
        authorLogin: c.author?.username ? text(c.author.username, 100) : null,
      };
    })
    .filter((c: PushCommit) => c.sha && c.message);

  return {
    githubRepoId: String(repo.id),
    fullName: text(repo.full_name, 200),
    ref: text(payload.ref, 255),
    beforeSha: text(payload.before, 64),
    afterSha: text(payload.after, 64),
    pusherLogin: payload.sender?.login ? text(payload.sender.login, 100) : null,
    compareUrl: httpsUrl(payload.compare),
    commits,
    pushedAt:
      typeof payload.head_commit?.timestamp === "string"
        ? text(payload.head_commit.timestamp, 40)
        : new Date().toISOString(),
    deleted: payload.deleted === true,
  };
}
