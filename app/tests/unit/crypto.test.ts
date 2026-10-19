import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DecryptionError,
  decrypt,
  encrypt,
  generateMasterKey,
  keyVersionOf,
  needsRotation,
  parseKeyring,
  rotate,
} from "@/lib/crypto";

const k1 = generateMasterKey();
const k2 = generateMasterKey();
const ring1 = parseKeyring(`v1:${k1}`, "v1");
const ring12 = parseKeyring(`v1:${k1},v2:${k2}`, "v2");

// Flip one bit in the decoded bytes of a dot-separated part.
function tamper(serialized: string, partIndex: number): string {
  const parts = serialized.split(".");
  const bytes = Buffer.from(parts[partIndex], "base64url");
  bytes[bytes.length - 1] ^= 0x01;
  parts[partIndex] = bytes.toString("base64url");
  return parts.join(".");
}

describe("envelope encryption", () => {
  it("round-trips a value", () => {
    const secret = "gho_exampleAccessToken1234567890";
    const stored = encrypt(secret, ring1);
    expect(stored).not.toContain(secret);
    expect(decrypt(stored, ring1)).toBe(secret);
  });

  it("round-trips empty and unicode values", () => {
    expect(decrypt(encrypt("", ring1), ring1)).toBe("");
    expect(decrypt(encrypt("héllo ✓ 你好", ring1), ring1)).toBe("héllo ✓ 你好");
  });

  it("uses a fresh nonce and data key for every value", () => {
    const a = encrypt("same", ring1).split(".");
    const b = encrypt("same", ring1).split(".");
    for (const i of [2, 3, 4, 5]) expect(a[i]).not.toBe(b[i]);
  });

  it("records the master key version", () => {
    const stored = encrypt("x", ring12);
    expect(keyVersionOf(stored)).toBe("v2");
    expect(stored.startsWith("jd1.v2.")).toBe(true);
  });

  it.each([
    ["wrap nonce", 2],
    ["wrapped data key", 3],
    ["value nonce", 4],
    ["ciphertext", 5],
  ])("rejects a tampered %s", (_name, index) => {
    const stored = encrypt("top secret", ring1);
    expect(() => decrypt(tamper(stored, index), ring1)).toThrow(DecryptionError);
  });

  it("rejects a value whose key version label was changed", () => {
    const stored = encrypt("top secret", ring12);
    const relabeled = stored.replace(/^jd1\.v2\./, "jd1.v1.");
    expect(() => decrypt(relabeled, ring12)).toThrow(DecryptionError);
  });

  it("rejects a truncated or malformed value", () => {
    const stored = encrypt("top secret", ring1);
    expect(() => decrypt(stored.slice(0, -4), ring1)).toThrow(DecryptionError);
    expect(() => decrypt("not-encrypted", ring1)).toThrow(DecryptionError);
    expect(() => decrypt(stored.replace(/^jd1/, "jd9"), ring1)).toThrow(DecryptionError);
  });

  it("binds a value to its context", () => {
    const stored = encrypt("token", ring1, { context: "account:1:accessToken" });
    expect(decrypt(stored, ring1, { context: "account:1:accessToken" })).toBe("token");
    expect(() => decrypt(stored, ring1, { context: "account:2:accessToken" })).toThrow(DecryptionError);
    expect(() => decrypt(stored, ring1)).toThrow(DecryptionError);
  });

  it("fails with the wrong master key", () => {
    const other = parseKeyring(`v1:${generateMasterKey()}`, "v1");
    expect(() => decrypt(encrypt("x", ring1), other)).toThrow(DecryptionError);
  });

  it("fails when the key version is not in the keyring", () => {
    const stored = encrypt("x", ring12);
    expect(() => decrypt(stored, ring1)).toThrow(DecryptionError);
  });
});

describe("rotation", () => {
  it("re-wraps an old value with the active key without changing its ciphertext", () => {
    const old = encrypt("refresh-token", ring1, { context: "c" });
    expect(needsRotation(old, ring12)).toBe(true);

    const rotated = rotate(old, ring12, { context: "c" });
    expect(keyVersionOf(rotated)).toBe("v2");
    expect(needsRotation(rotated, ring12)).toBe(false);
    expect(rotated.split(".").slice(4)).toEqual(old.split(".").slice(4));
    expect(decrypt(rotated, ring12, { context: "c" })).toBe("refresh-token");

    // Once rotated, the old master key can be retired.
    const ring2only = parseKeyring(`v2:${k2}`, "v2");
    expect(decrypt(rotated, ring2only, { context: "c" })).toBe("refresh-token");
  });

  it("leaves a current value unchanged", () => {
    const current = encrypt("x", ring12);
    expect(rotate(current, ring12)).toBe(current);
  });

  it("refuses to rotate a tampered value", () => {
    const old = encrypt("x", ring1);
    expect(() => rotate(tamper(old, 5), ring12)).toThrow(DecryptionError);
  });
});

describe("parseKeyring", () => {
  it("rejects keys of the wrong length", () => {
    const short = randomBytes(16).toString("base64");
    expect(() => parseKeyring(`v1:${short}`, "v1")).toThrow(/32 bytes/);
  });

  it("rejects a missing active version, bad entries and duplicates", () => {
    expect(() => parseKeyring(`v1:${k1}`, "v2")).toThrow(/not in the keyring/);
    expect(() => parseKeyring(k1, "v1")).toThrow();
    expect(() => parseKeyring(`V 1:${k1}`, "V 1")).toThrow(/versions/);
    expect(() => parseKeyring(`v1:${k1},v1:${k2}`, "v1")).toThrow(/Duplicate/);
  });
});
