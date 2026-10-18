// Prints a new random master key for ENCRYPTION_MASTER_KEYS.
// Usage: npm run keygen   ->   add it as "<version>:<key>" in your secret store.
import { randomBytes } from "node:crypto";

console.log(randomBytes(32).toString("base64"));
