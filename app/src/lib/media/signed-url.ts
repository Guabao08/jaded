import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { env } from "../env";

/**
 * Short-lived signed links for private media. A link is
 *   /api/media/<mediaId>?exp=<unix seconds>&sig=<HMAC-SHA256(mediaId.exp)>
 * Anyone with the link can load the image until it expires (social platforms
 * will need that to fetch images at publish time), so links last minutes.
 * The signing key is derived from AUTH_SECRET for this one purpose.
 */
export const MEDIA_URL_TTL_SECONDS = 10 * 60;
const MAX_TTL_SECONDS = 60 * 60;

export function mediaSigningKey(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "jaded", "media-url-v1", 32));
}

function sign(key: Buffer, mediaId: string, exp: number): string {
  return createHmac("sha256", key).update(`${mediaId}.${exp}`).digest("base64url");
}

export function signMediaPath(mediaId: string, opts: { key?: Buffer; ttlSeconds?: number; now?: number } = {}): string {
  const key = opts.key ?? mediaSigningKey(env().AUTH_SECRET);
  const ttl = Math.min(opts.ttlSeconds ?? MEDIA_URL_TTL_SECONDS, MAX_TTL_SECONDS);
  const exp = Math.floor((opts.now ?? Date.now()) / 1000) + ttl;
  return `/api/media/${encodeURIComponent(mediaId)}?exp=${exp}&sig=${sign(key, mediaId, exp)}`;
}

export type MediaUrlCheck = { ok: true; secondsLeft: number } | { ok: false; reason: "missing" | "expired" | "bad" };

export function verifyMediaSignature(
  mediaId: string,
  expParam: string | null,
  sigParam: string | null,
  opts: { key?: Buffer; now?: number } = {},
): MediaUrlCheck {
  if (!expParam || !sigParam || !/^\d{1,12}$/.test(expParam) || !/^[A-Za-z0-9_-]{43}$/.test(sigParam)) {
    return { ok: false, reason: "missing" };
  }
  const key = opts.key ?? mediaSigningKey(env().AUTH_SECRET);
  const exp = Number(expParam);
  const expected = Buffer.from(sign(key, mediaId, exp));
  const given = Buffer.from(sigParam);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "bad" };
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  if (exp <= now) return { ok: false, reason: "expired" };
  if (exp > now + MAX_TTL_SECONDS) return { ok: false, reason: "bad" };
  return { ok: true, secondsLeft: exp - now };
}
