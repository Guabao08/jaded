import type { PrismaClient } from "@/generated/prisma/client";
import type { AuditEntry } from "../audit";
import { hashSessionToken } from "./adapter";
import { SESSION_COOKIE } from "./config";

/**
 * Session rotation on login. Auth.js keeps an existing session when a signed-in
 * user signs in again, so before it handles an OAuth callback we revoke any
 * session the request presents. Auth.js then always issues a fresh session ID,
 * and a session ID planted before login (session fixation) is useless.
 */
export async function revokePresentedSession(
  request: Request,
  deps: { db: () => PrismaClient; audit: (entry: AuditEntry) => Promise<void> },
): Promise<void> {
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  if (!token) return;
  const session = await deps.db().session.findUnique({ where: { sessionTokenHash: hashSessionToken(token) } });
  if (!session) return;
  await deps.db().session.delete({ where: { id: session.id } });
  await deps.audit({ action: "auth.session_revoked_on_login", actorUserId: session.userId });
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

export function isOAuthCallback(request: Request): boolean {
  return new URL(request.url).pathname.startsWith("/api/auth/callback/");
}
