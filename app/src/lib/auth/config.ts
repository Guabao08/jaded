import type { NextAuthConfig } from "next-auth";
import GitHub from "next-auth/providers/github";
import type { Env } from "../env";
import type { AuditEntry } from "../audit";
import { createAdapter, type GitHubUserFields } from "./adapter";
import type { PrismaClient } from "@/generated/prisma/client";

export const SESSION_COOKIE = "__Secure-jaded.session";
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
export const SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60;

/** Session cookie flags required by the security baseline. */
export const sessionCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
} as const;

interface GitHubProfile {
  id: number;
  login: string;
  name?: string | null;
  avatar_url?: string | null;
}

export interface AuthDeps {
  db: () => PrismaClient;
  audit: (entry: AuditEntry) => Promise<void>;
}

export function isAllowedGitHubId(env: Pick<Env, "AUTH_ALLOWED_GITHUB_IDS">, githubId: string | undefined): boolean {
  return githubId !== undefined && env.AUTH_ALLOWED_GITHUB_IDS.includes(githubId);
}

export function buildAuthConfig(env: Env, deps: AuthDeps): NextAuthConfig {
  return {
    secret: env.AUTH_SECRET,
    adapter: createAdapter(deps.db),
    providers: [
      GitHub({
        clientId: env.AUTH_GITHUB_ID,
        clientSecret: env.AUTH_GITHUB_SECRET,
        ...(env.AUTH_GITHUB_BASE_URL ? { enterprise: { baseUrl: env.AUTH_GITHUB_BASE_URL } } : {}),
        // No scopes: sign-in only needs the public profile. No email is requested.
        authorization: { params: { scope: "" } },
        profile(profile: GitHubProfile) {
          const fields: GitHubUserFields = { githubId: String(profile.id), githubLogin: profile.login };
          return {
            id: String(profile.id),
            name: profile.name ?? profile.login,
            image: profile.avatar_url ?? null,
            email: null,
            ...fields,
          };
        },
      }),
    ],
    session: {
      strategy: "database",
      maxAge: SESSION_MAX_AGE_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
    },
    useSecureCookies: true,
    cookies: {
      sessionToken: { name: SESSION_COOKIE, options: { ...sessionCookieOptions } },
    },
    pages: { signIn: "/signin", error: "/signin" },
    callbacks: {
      async signIn({ account, profile }) {
        const githubId = account?.providerAccountId;
        if (account?.provider === "github" && isAllowedGitHubId(env, githubId)) return true;
        await deps.audit({
          action: "auth.sign_in_denied",
          metadata: {
            provider: account?.provider,
            githubId,
            githubLogin: (profile as GitHubProfile | undefined)?.login,
          },
        });
        return false;
      },
      session({ session, user }) {
        const u = user as typeof user & GitHubUserFields;
        return {
          ...session,
          user: { id: u.id, name: u.name, image: u.image, githubLogin: u.githubLogin, email: "" },
        };
      },
    },
    events: {
      async signIn({ user, account, isNewUser }) {
        await deps.audit({
          action: "auth.sign_in",
          actorUserId: user.id,
          metadata: { provider: account?.provider, isNewUser: Boolean(isNewUser) },
        });
      },
      async signOut(message) {
        const userId = "session" in message ? message.session?.userId : undefined;
        await deps.audit({ action: "auth.sign_out", actorUserId: userId ?? null });
      },
    },
  };
}
