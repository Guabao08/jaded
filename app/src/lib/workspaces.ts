import { notFound } from "next/navigation";
import { db } from "./db";

/**
 * Workspace data access. Every query is scoped to a workspace the signed-in
 * user belongs to, so a user can never read another workspace's data. Pages
 * and actions must go through these helpers instead of querying directly.
 */

export async function listWorkspacesForUser(userId: string) {
  return db().workspace.findMany({
    where: { memberships: { some: { userId } } },
    select: { id: true, name: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
}

/** Returns null when the workspace does not exist or the user is not a member. */
export async function getWorkspaceForUser(userId: string, workspaceId: string) {
  return db().workspace.findFirst({
    where: { id: workspaceId, memberships: { some: { userId } } },
    select: {
      id: true,
      name: true,
      createdAt: true,
      memberships: { where: { userId }, select: { role: true } },
    },
  });
}

/**
 * Verifies membership, then returns queries bound to that workspace. Use
 * `requireWorkspace` in pages and actions; it 404s for non-members.
 */
export async function workspaceScope(userId: string, workspaceId: string) {
  const workspace = await getWorkspaceForUser(userId, workspaceId);
  if (!workspace) return null;
  const id = workspace.id;
  return {
    workspace,
    listApps: () =>
      db().app.findMany({
        where: { workspaceId: id },
        include: { repository: { select: { fullName: true } }, brandProfile: { select: { iconUrl: true } } },
        orderBy: { createdAt: "asc" },
      }),
    getApp: (appId: string) =>
      db().app.findFirst({
        where: { id: appId, workspaceId: id },
        include: { repository: true, brandProfile: true, listings: { orderBy: { importedAt: "desc" } } },
      }),
    createApp: (name: string) => db().app.create({ data: { workspaceId: id, name } }),
    listRepositories: () => db().repository.findMany({ where: { workspaceId: id }, orderBy: { fullName: "asc" } }),
    getRepository: (repositoryId: string) =>
      db().repository.findFirst({ where: { id: repositoryId, workspaceId: id } }),
    listInstallations: () => db().gitHubInstallation.findMany({ where: { workspaceId: id } }),
    listUpdates: (take = 50) =>
      db().update.findMany({
        where: { workspaceId: id },
        include: { repository: { select: { fullName: true } }, _count: { select: { posts: true } } },
        orderBy: { createdAt: "desc" },
        take,
      }),
    getUpdate: (updateId: string) => db().update.findFirst({ where: { id: updateId, workspaceId: id } }),
    listPosts: (take = 50) =>
      db().post.findMany({
        where: { workspaceId: id },
        include: {
          media: { orderBy: { position: "asc" } },
          app: { select: { name: true } },
          update: { select: { id: true, afterSha: true, repository: { select: { fullName: true } } } },
        },
        orderBy: [{ createdAt: "desc" }, { platform: "asc" }],
        take,
      }),
    aiSpendThisMonth: async (month: string) =>
      await db().aiUsage.aggregate({
        where: { workspaceId: id, month },
        _sum: { estimatedCostMicro: true },
        _count: true,
      }),
  };
}

export type WorkspaceScope = NonNullable<Awaited<ReturnType<typeof workspaceScope>>>;

export async function requireWorkspace(userId: string, workspaceId: string): Promise<WorkspaceScope> {
  const scope = await workspaceScope(userId, workspaceId);
  if (!scope) notFound();
  return scope;
}
