/**
 * Removes secrets from anything about to be logged or sent to the error
 * tracker. Two passes:
 *  - by key: values under sensitive-looking keys (tokens, cookies, auth
 *    headers, webhook signatures, request bodies) are replaced whole;
 *  - by value: strings are scanned for token shapes (bearer tokens, GitHub
 *    and Anthropic keys, JWTs, our own ciphertexts, URL credentials).
 */
export const REDACTED = "[REDACTED]";

const MAX_DEPTH = 8;

// Matched against keys after lowercasing and stripping "-" and "_".
const SENSITIVE_KEY_PARTS = [
  "token",
  "secret",
  "password",
  "passwd",
  "authorization",
  "cookie",
  "apikey",
  "privatekey",
  "signature",
  "credential",
  "session",
  "masterkey",
  "encryptionkey",
  "clientsecret",
  "dsn",
];

// Full request/response bodies are never logged.
const SENSITIVE_KEYS_EXACT = new Set(["body", "rawbody", "payload", "databaseurl", "connectionstring"]);

const VALUE_PATTERNS: RegExp[] = [
  /\b(Bearer|Basic|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  /\bjd1\.[a-z0-9]{1,16}\.[A-Za-z0-9_.-]{20,}/g,
  /\b(AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\bsha256=[a-f0-9]{64}\b/gi,
  /\b(EAA[A-Za-z0-9]{20,}|ya29\.[A-Za-z0-9_-]{20,})\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

// user:password@ in URLs, e.g. postgres://jaded:hunter2@db/jaded
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)([^\s:/@]+):([^\s/@]+)@/gi;

export function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_]/g, "");
  if (SENSITIVE_KEYS_EXACT.has(normalized)) return true;
  return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
}

export function redactString(value: string): string {
  let out = value.replace(URL_CREDENTIALS, `$1${REDACTED}@`);
  for (const pattern of VALUE_PATTERNS) out = out.replace(pattern, REDACTED);
  return out;
}

export function redact(value: unknown): unknown {
  return walk(value, 0, new WeakSet());
}

function walk(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") {
    return typeof value === "bigint" ? value.toString() : value;
  }
  if (seen.has(value)) return "[Circular]";
  if (depth >= MAX_DEPTH) return "[Truncated]";
  seen.add(value);

  if (value instanceof Error) {
    const out: Record<string, unknown> = {
      name: value.name,
      message: redactString(value.message),
    };
    if (value.stack) out.stack = redactString(value.stack);
    if (value.cause !== undefined) out.cause = walk(value.cause, depth + 1, seen);
    return out;
  }
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) return `[Binary ${value.byteLength} bytes]`;
  if (typeof Headers !== "undefined" && value instanceof Headers) {
    return walk(Object.fromEntries(value.entries()), depth, seen);
  }
  if (value instanceof Map) return walk(Object.fromEntries(value), depth, seen);
  if (Array.isArray(value)) return value.map((item) => walk(item, depth + 1, seen));

  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    out[key] = isSensitiveKey(key) ? REDACTED : walk(inner, depth + 1, seen);
  }
  return out;
}
