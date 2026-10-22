/**
 * Environment validation. Runs when Next.js loads its config (dev, build,
 * start), so the app refuses to start if anything required is missing or
 * malformed. Error messages name variables, never their values.
 */
import { z } from "zod";
import { parseKeyring } from "./crypto";

// Production builds must use https, except on loopback (local `next start`
// and end-to-end tests), which can never be a real deployment.
export function isLoopbackUrl(value: string): boolean {
  const host = new URL(value).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

const httpsInProduction = (value: string, nodeEnv: string | undefined) =>
  nodeEnv !== "production" || value.startsWith("https://") || isLoopbackUrl(value);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_URL: z.url({ protocol: /^https?$/ }),
    DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, "must be a postgres:// connection string"),
    ENCRYPTION_MASTER_KEYS: z.string().min(1),
    ENCRYPTION_ACTIVE_KEY_VERSION: z.string().min(1),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    // Auth.js: signs CSRF tokens and encrypts OAuth state cookies.
    AUTH_SECRET: z.string().min(32, "must be at least 32 characters"),
    // GitHub OAuth App used for sign-in.
    AUTH_GITHUB_ID: z.string().min(1),
    AUTH_GITHUB_SECRET: z.string().min(1),
    // Numeric GitHub user IDs allowed to sign in while testing (comma-separated).
    AUTH_ALLOWED_GITHUB_IDS: z
      .string()
      .regex(/^\s*\d+(\s*,\s*\d+)*\s*$/, "must be comma-separated numeric GitHub user IDs")
      .transform((value) => value.split(",").map((id) => id.trim())),
    // Test-only: points sign-in and the GitHub API at a fake GitHub. Allowed only when APP_URL is loopback.
    GITHUB_TEST_BASE_URL: z.url({ protocol: /^https?$/ }).optional(),
    // GitHub App (repository access and push webhooks). Optional as a group:
    // until it is created, the app runs and shows "GitHub not configured".
    GITHUB_APP_ID: z.string().regex(/^\d+$/, "must be the numeric App ID").optional(),
    GITHUB_APP_SLUG: z
      .string()
      .regex(/^[a-z0-9-]+$/, "must be the app's URL name")
      .optional(),
    // PEM private key, either as-is (literal "\n" escapes allowed) or base64-encoded.
    GITHUB_APP_PRIVATE_KEY: z.string().min(1).optional(),
    GITHUB_APP_CLIENT_ID: z.string().min(1).optional(),
    GITHUB_APP_CLIENT_SECRET: z.string().min(1).optional(),
    GITHUB_WEBHOOK_SECRET: z.string().min(32, "must be at least 32 characters").optional(),
    // Post writing. "fake" is a stand-in for tests and local runs, allowed only with a loopback APP_URL.
    AI_PROVIDER: z.enum(["gemini", "fake"]).default("gemini"),
    // Server-only. Without it, generation waits with a "not configured" note.
    GEMINI_API_KEY: z.string().min(20, "doesn't look like a Gemini API key").optional(),
    GEMINI_MODEL: z
      .string()
      .regex(/^[a-z0-9.-]+$/, "must be a Gemini model ID such as gemini-3.8-flash")
      .default("gemini-3.8-flash"),
    // Used when the main model stays unavailable or rate-limited. Set to "none" to turn off.
    GEMINI_FALLBACK_MODEL: z
      .string()
      .regex(/^[a-z0-9.-]+$/, "must be a Gemini model ID such as gemini-3.5-flash-lite, or none")
      .default("gemini-3.5-flash-lite")
      .transform((v) => (v === "none" ? "" : v)),
    // Estimated AI spend allowed per workspace per calendar month (UTC), in US dollars.
    AI_MONTHLY_CAP_USD: z.coerce.number().min(0).max(1000).default(10),
    // Where generated images are stored until a cloud bucket is configured. Private; never served directly.
    MEDIA_DIR: z.string().min(1).default(".data/media"),
  })
  .superRefine((env, ctx) => {
    if (!httpsInProduction(env.APP_URL, env.NODE_ENV)) {
      ctx.addIssue({ code: "custom", path: ["APP_URL"], message: "must use https in production" });
    }
    if (env.AI_PROVIDER === "fake" && !isLoopbackUrl(env.APP_URL)) {
      ctx.addIssue({ code: "custom", path: ["AI_PROVIDER"], message: "fake is only allowed for local testing" });
    }
    if (["127.0.0.1", "[::1]"].includes(new URL(env.APP_URL).hostname)) {
      // Next.js rewrites loopback IPs to "localhost" in requests, which breaks sign-in redirects.
      ctx.addIssue({ code: "custom", path: ["APP_URL"], message: "must use localhost instead of a loopback IP" });
    }
    if (env.GITHUB_TEST_BASE_URL && !(isLoopbackUrl(env.APP_URL) && isLoopbackUrl(env.GITHUB_TEST_BASE_URL))) {
      ctx.addIssue({
        code: "custom",
        path: ["GITHUB_TEST_BASE_URL"],
        message: "is only allowed for local testing (loopback APP_URL and base URL)",
      });
    }
    const appVars = [
      "GITHUB_APP_ID",
      "GITHUB_APP_SLUG",
      "GITHUB_APP_PRIVATE_KEY",
      "GITHUB_APP_CLIENT_ID",
      "GITHUB_APP_CLIENT_SECRET",
      "GITHUB_WEBHOOK_SECRET",
    ] as const;
    const set = appVars.filter((name) => env[name] !== undefined);
    if (set.length > 0 && set.length < appVars.length) {
      for (const name of appVars.filter((n) => env[n] === undefined)) {
        ctx.addIssue({ code: "custom", path: [name], message: "is required when any GITHUB_APP_* variable is set" });
      }
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

export interface GitHubAppEnv {
  appId: string;
  slug: string;
  privateKey: string;
  clientId: string;
  clientSecret: string;
  webhookSecret: string;
}

/** The GitHub App settings, or null when the App is not configured yet. */
export function githubAppEnv(e: Env): GitHubAppEnv | null {
  if (!e.GITHUB_APP_ID || !e.GITHUB_APP_SLUG || !e.GITHUB_APP_PRIVATE_KEY) return null;
  if (!e.GITHUB_APP_CLIENT_ID || !e.GITHUB_APP_CLIENT_SECRET || !e.GITHUB_WEBHOOK_SECRET) return null;
  const raw = e.GITHUB_APP_PRIVATE_KEY.trim();
  const privateKey = raw.startsWith("-----BEGIN")
    ? raw.replace(/\\n/g, "\n")
    : Buffer.from(raw, "base64").toString("utf8");
  return {
    appId: e.GITHUB_APP_ID,
    slug: e.GITHUB_APP_SLUG,
    privateKey,
    clientId: e.GITHUB_APP_CLIENT_ID,
    clientSecret: e.GITHUB_APP_CLIENT_SECRET,
    webhookSecret: e.GITHUB_WEBHOOK_SECRET,
  };
}

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
