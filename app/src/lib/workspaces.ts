import { db } from "./db";

/**
 * Workspace data access. Every function takes the signed-in user's ID and
 * scopes its query through Membership, so a user can never read a workspace
 * they do not belong to. Pages must use these instead of querying directly.
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
