import { parseKeyring, type Keyring } from "./crypto";
import { env } from "./env";

let cached: Keyring | undefined;

/**
 * The app's master keyring, from ENCRYPTION_MASTER_KEYS (held in the host's
 * secret manager). Server-only; never send keys or keyring objects to clients.
 */
export function appKeyring(): Keyring {
  const { ENCRYPTION_MASTER_KEYS, ENCRYPTION_ACTIVE_KEY_VERSION } = env();
  cached ??= parseKeyring(ENCRYPTION_MASTER_KEYS, ENCRYPTION_ACTIVE_KEY_VERSION);
  return cached;
}
