/**
 * Envelope encryption for sensitive fields (OAuth tokens, app credentials).
 *
 * Each value gets its own random 256-bit data key. The value is encrypted with
 * that data key (AES-256-GCM, fresh 96-bit nonce), and the data key is wrapped
 * with a versioned master key (also AES-256-GCM). Only the wrapped data key is
 * stored next to the ciphertext; master keys come from the host's secret
 * manager and are never written to the database.
 *
 * Rotation re-wraps the data key with the active master key. The value's own
 * ciphertext does not change.
 *
 * Serialized format (all parts base64url):
 *   jd1.<keyVersion>.<wrapNonce>.<wrappedKey+tag>.<nonce>.<ciphertext+tag>
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const FORMAT = "jd1";
const ALG = "aes-256-gcm";
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_VERSION_PATTERN = /^[a-z0-9]{1,16}$/;

export class DecryptionError extends Error {
  constructor(message = "Unable to decrypt value") {
    super(message);
    this.name = "DecryptionError";
  }
}

export interface Keyring {
  activeVersion: string;
  keys: ReadonlyMap<string, Buffer>;
}

export interface EncryptOptions {
  /**
   * Associated data the value is bound to, such as "account:<id>:accessToken".
   * Decrypting with a different context fails, so a ciphertext copied onto
   * another record is rejected.
   */
  context?: string;
}

/**
 * Builds a keyring from `v1:<base64 key>,v2:<base64 key>` and the active
 * version. Throws if a key is not exactly 32 bytes or the active one is absent.
 */
export function parseKeyring(spec: string, activeVersion: string): Keyring {
  const keys = new Map<string, Buffer>();
  for (const entry of spec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    const sep = entry.indexOf(":");
    if (sep <= 0) throw new Error("Master key entries must look like <version>:<base64 key>");
    const version = entry.slice(0, sep);
    if (!KEY_VERSION_PATTERN.test(version)) {
      throw new Error("Master key versions must be 1-16 lowercase letters or digits");
    }
    if (keys.has(version)) throw new Error(`Duplicate master key version ${version}`);
    const key = Buffer.from(entry.slice(sep + 1), "base64");
    if (key.length !== KEY_BYTES) {
      throw new Error(`Master key ${version} must decode to ${KEY_BYTES} bytes`);
    }
    keys.set(version, key);
  }
  if (!keys.has(activeVersion)) {
    throw new Error(`Active master key version ${activeVersion} is not in the keyring`);
  }
  return { activeVersion, keys };
}

/** Generates a new base64 master key, for `npm run keygen`. */
export function generateMasterKey(): string {
  return randomBytes(KEY_BYTES).toString("base64");
}

export function encrypt(plaintext: string, keyring: Keyring, options: EncryptOptions = {}): string {
  const dataKey = randomBytes(KEY_BYTES);
  try {
    const version = keyring.activeVersion;
    const nonce = randomBytes(NONCE_BYTES);
    const body = seal(dataKey, nonce, Buffer.from(plaintext, "utf8"), valueAad(options));
    const wrapped = wrapDataKey(dataKey, keyring, version);
    return [FORMAT, version, b64(wrapped.nonce), b64(wrapped.sealed), b64(nonce), b64(body)].join(".");
  } finally {
    dataKey.fill(0);
  }
}

export function decrypt(serialized: string, keyring: Keyring, options: EncryptOptions = {}): string {
  const parts = parse(serialized);
  const dataKey = unwrapDataKey(parts, keyring);
  try {
    const plaintext = open(dataKey, parts.nonce, parts.body, valueAad(options));
    return plaintext.toString("utf8");
  } finally {
    dataKey.fill(0);
  }
}

/** The master key version a stored value is wrapped with. */
export function keyVersionOf(serialized: string): string {
  return parse(serialized).version;
}

export function needsRotation(serialized: string, keyring: Keyring): boolean {
  return keyVersionOf(serialized) !== keyring.activeVersion;
}

/**
 * Re-wraps a value's data key with the active master key. The old master key
 * must still be in the keyring. Returns the input unchanged if it is current.
 */
export function rotate(serialized: string, keyring: Keyring, options: EncryptOptions = {}): string {
  const parts = parse(serialized);
  if (parts.version === keyring.activeVersion) return serialized;
  const dataKey = unwrapDataKey(parts, keyring);
  try {
    // Prove the value still opens before replacing its wrapper.
    open(dataKey, parts.nonce, parts.body, valueAad(options)).fill(0);
    const wrapped = wrapDataKey(dataKey, keyring, keyring.activeVersion);
    return [
      FORMAT,
      keyring.activeVersion,
      b64(wrapped.nonce),
      b64(wrapped.sealed),
      b64(parts.nonce),
      b64(parts.body),
    ].join(".");
  } finally {
    dataKey.fill(0);
  }
}

interface Parts {
  version: string;
  wrapNonce: Buffer;
  wrappedKey: Buffer;
  nonce: Buffer;
  body: Buffer;
}

function parse(serialized: string): Parts {
  const pieces = serialized.split(".");
  if (pieces.length !== 6 || pieces[0] !== FORMAT || !KEY_VERSION_PATTERN.test(pieces[1])) {
    throw new DecryptionError("Malformed encrypted value");
  }
  const [, version, wrapNonce, wrappedKey, nonce, body] = pieces;
  const parts = {
    version,
    wrapNonce: unb64(wrapNonce),
    wrappedKey: unb64(wrappedKey),
    nonce: unb64(nonce),
    body: unb64(body),
  };
  if (
    parts.wrapNonce.length !== NONCE_BYTES ||
    parts.nonce.length !== NONCE_BYTES ||
    parts.wrappedKey.length !== KEY_BYTES + TAG_BYTES ||
    parts.body.length < TAG_BYTES
  ) {
    throw new DecryptionError("Malformed encrypted value");
  }
  return parts;
}

function wrapDataKey(dataKey: Buffer, keyring: Keyring, version: string) {
  const masterKey = keyring.keys.get(version);
  if (!masterKey) throw new Error(`Master key ${version} is not in the keyring`);
  const nonce = randomBytes(NONCE_BYTES);
  return { nonce, sealed: seal(masterKey, nonce, dataKey, wrapAad(version)) };
}

function unwrapDataKey(parts: Parts, keyring: Keyring): Buffer {
  const masterKey = keyring.keys.get(parts.version);
  if (!masterKey) throw new DecryptionError(`Master key ${parts.version} is not in the keyring`);
  return open(masterKey, parts.wrapNonce, parts.wrappedKey, wrapAad(parts.version));
}

function seal(key: Buffer, nonce: Buffer, plaintext: Buffer, aad: Buffer): Buffer {
  const cipher = createCipheriv(ALG, key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad);
  return Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}

function open(key: Buffer, nonce: Buffer, sealed: Buffer, aad: Buffer): Buffer {
  try {
    const decipher = createDecipheriv(ALG, key, nonce, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad);
    decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
    return Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - TAG_BYTES)), decipher.final()]);
  } catch {
    throw new DecryptionError();
  }
}

function wrapAad(version: string): Buffer {
  return Buffer.from(`${FORMAT}|wrap|${version}`, "utf8");
}

// The key version is bound by the wrapped key's associated data, so the value's
// own ciphertext does not depend on it and survives rotation unchanged.
function valueAad(options: EncryptOptions): Buffer {
  return Buffer.from(`${FORMAT}|value|${options.context ?? ""}`, "utf8");
}

function b64(buf: Buffer): string {
  return buf.toString("base64url");
}

function unb64(s: string): Buffer {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new DecryptionError("Malformed encrypted value");
  return Buffer.from(s, "base64url");
}
