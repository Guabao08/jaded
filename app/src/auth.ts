import NextAuth from "next-auth";
import { recordAudit } from "@/lib/audit";
import { buildAuthConfig } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

declare module "next-auth" {
  interface Session {
    user: { id: string; name?: string | null; image?: string | null; githubLogin: string; email: string };
  }
}

// Auth.js builds its URLs (callback, redirects) from AUTH_URL. Pinning it to
// APP_URL means a forged Host header cannot change them.
process.env.AUTH_URL ??= process.env.APP_URL;

// The config is built on first use so nothing validates the environment at import time.
export const { handlers, auth, signIn, signOut } = NextAuth(() => buildAuthConfig(env(), { db, audit: recordAudit }));
