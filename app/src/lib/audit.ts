import { headers } from "next/headers";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { log, redact } from "./log";

export type AuditAction = "auth.sign_in" | "auth.sign_in_denied" | "auth.sign_out" | "auth.session_revoked_on_login";

export interface AuditEntry {
  action: AuditAction;
  actorUserId?: string | null;
  workspaceId?: string | null;
  metadata?: Record<string, unknown>;
}

async function requestContext(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const h = await headers();
    // The host's load balancer appends the client address; take the first hop.
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
    return { ip, userAgent: h.get("user-agent")?.slice(0, 300) ?? null };
  } catch {
    return { ip: null, userAgent: null }; // Outside a request.
  }
}

/** Appends an audit record. Metadata is redacted; never pass tokens or bodies. */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  const context = await requestContext();
  try {
    await db().auditLog.create({
      data: {
        action: entry.action,
        actorUserId: entry.actorUserId ?? null,
        workspaceId: entry.workspaceId ?? null,
        metadata: entry.metadata ? (redact(entry.metadata) as Prisma.InputJsonValue) : undefined,
        ...context,
      },
    });
  } catch (error) {
    // An audit failure must be visible, but must not leak the entry's contents.
    log.error("audit log write failed", { action: entry.action, error });
    throw error;
  }
}
