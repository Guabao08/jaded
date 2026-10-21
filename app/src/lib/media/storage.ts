import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { env } from "../env";

/**
 * Private media storage. Local folder for now; an S3-compatible bucket
 * (Cloudflare R2) implements the same interface once hosting is chosen.
 * Nothing in here is ever served directly: only /api/media with a valid
 * signed URL reads from it.
 */
export interface MediaStorage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

const KEY = /^[a-z0-9]+(?:\/[a-z0-9]+)*\.(?:png|jpg)$/;

export function createLocalStorage(root: string): MediaStorage {
  const base = resolve(root);
  const pathFor = (key: string) => {
    if (!KEY.test(key)) throw new Error("Invalid media key");
    const full = resolve(join(base, key));
    const rel = relative(base, full);
    if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Invalid media key");
    return full;
  };
  return {
    async put(key, bytes) {
      const path = pathFor(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes, { mode: 0o600 });
    },
    async get(key) {
      try {
        return new Uint8Array(await readFile(pathFor(key)));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async delete(key) {
      await rm(pathFor(key), { force: true });
    },
  };
}

let cached: MediaStorage | undefined;
export function mediaStorage(): MediaStorage {
  cached ??= createLocalStorage(env().MEDIA_DIR);
  return cached;
}
