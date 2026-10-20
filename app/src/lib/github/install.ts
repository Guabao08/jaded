import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import type { AuditEntry } from "../audit";
import type { GitHubClient } from "./client";
import { syncRepositories } from "./process";

export const INSTALL_STATE_COOKIE = "__Secure-jaded.gh-install";
export const INSTALL_STATE_MAX_AGE = 10 * 60;

export function newInstallState(): string {
  return randomBytes(24).toString("base64url");
}

export class InstallError extends Error {
  constructor(readonly code: "state" | "missing" | "not_yours" | "other_workspace") {
    super(code);
  }
}

/**
 * Links a GitHub App installation to a workspace after the install redirect.
 * The installation ID in the URL is not trusted on its own: GitHub's
 * user-authorization step gives us a code, and we only link the installation
 * if GitHub confirms that this user can access it. The user token is revoked
 * right after; nothing from GitHub is stored except the installation's identity.
 */
export async function completeInstallation(
  input: {
    userId: string;
    workspaceId: string;
    installationId: string | null;
    code: string | null;
  },
  deps: { db: () => PrismaClient; github: GitHubClient; audit: (entry: AuditEntry) => Promise<void> },
): Promise<void> {
  const { installationId, code } = input;
  if (!installationId || !/^\d{1,20}$/.test(installationId) || !code) throw new InstallError("missing");

  const userToken = await deps.github.exchangeUserCode(code);
  let accessible: string[];
  try {
    accessible = await deps.github.userInstallationIds(userToken);
  } finally {
    await deps.github.revokeUserToken(userToken);
  }
  if (!accessible.includes(installationId)) {
    await deps.audit({
      action: "github.installation_rejected",
      actorUserId: input.userId,
      workspaceId: input.workspaceId,
      metadata: { installationId, reason: "user cannot access installation" },
    });
    throw new InstallError("not_yours");
  }

  const existing = await deps.db().gitHubInstallation.findUnique({ where: { installationId } });
  if (existing && existing.workspaceId !== input.workspaceId) throw new InstallError("other_workspace");

  const info = await deps.github.getInstallation(installationId);
  const installation = await deps.db().gitHubInstallation.upsert({
    where: { installationId },
    update: { accountLogin: info.account.login, accountType: info.account.type, suspendedAt: null },
    create: {
      workspaceId: input.workspaceId,
      installationId,
      accountLogin: info.account.login,
      accountType: info.account.type,
    },
  });
  await syncRepositories(installation, deps.github, deps.db);
  await deps.audit({
    action: "github.installation_connected",
    actorUserId: input.userId,
    workspaceId: input.workspaceId,
    metadata: { installationId, account: info.account.login },
  });
}
