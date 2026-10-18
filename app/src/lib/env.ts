/**
 * Environment validation. Runs when Next.js loads its config (dev, build,
 * start), so the app refuses to start if anything required is missing or
 * malformed. Error messages name variables, never their values.
 */
import { z } from "zod";
import { parseKeyring } from "./crypto";

// Production builds must use https, except on loopback (local `next start`
// and end-to-end tests), which can never be a real deployment.
const httpsInProduction = (value: string, nodeEnv: string | undefined) => {
  if (nodeEnv !== "production" || value.startsWith("https://")) return true;
  const host = new URL(value).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
};

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_URL: z.url({ protocol: /^https?$/ }),
    DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, "must be a postgres:// connection string"),
    ENCRYPTION_MASTER_KEYS: z.string().min(1),
    ENCRYPTION_ACTIVE_KEY_VERSION: z.string().min(1),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  })
  .superRefine((env, ctx) => {
    if (!httpsInProduction(env.APP_URL, env.NODE_ENV)) {
      ctx.addIssue({ code: "custom", path: ["APP_URL"], message: "must use https in production" });
    }
    try {
      parseKeyring(env.ENCRYPTION_MASTER_KEYS, env.ENCRYPTION_ACTIVE_KEY_VERSION);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        path: ["ENCRYPTION_MASTER_KEYS"],
        message: error instanceof Error ? error.message : "invalid keyring",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export class EnvError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid environment:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "EnvError";
  }
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  // Treat empty strings as missing, so `FOO=` in .env does not count as set.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ""));
  const result = envSchema.safeParse(cleaned);
  if (result.success) return result.data;
  throw new EnvError(
    result.error.issues.map((issue) => {
      const name = issue.path.join(".") || "(root)";
      return issue.code === "invalid_type" && cleaned[name] === undefined
        ? `${name} is required`
        : `${name} ${issue.message}`;
    }),
  );
}

let cached: Env | undefined;

/** Validated environment for server code. Throws if invalid. */
export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
