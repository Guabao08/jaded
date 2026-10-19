import { createHash } from "node:crypto";
import type { Adapter, AdapterAccount, AdapterSession, AdapterUser } from "next-auth/adapters";
import type { PrismaClient, User } from "@/generated/prisma/client";

/** Session tokens are stored only as SHA-256 hashes. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

// Fields our GitHub provider's profile() adds on top of Auth.js's user shape.
export interface GitHubUserFields {
  githubId: string;
  githubLogin: string;
}

function toAdapterUser(user: User): AdapterUser {
  // Auth.js requires `email`/`emailVerified`; we deliberately do not collect email.
  return {
    id: user.id,
    name: user.name,
    image: user.image,
    email: "",
    emailVerified: null,
    githubId: user.githubId,
    githubLogin: user.githubLogin,
  } as AdapterUser;
}

/**
 * Auth.js adapter for our schema. Differences from the stock Prisma adapter:
 *  - session tokens are hashed before storage and lookup;
 *  - OAuth access/refresh/id tokens are discarded, never stored;
 *  - a new user gets their own workspace (as OWNER) in the same transaction;
 *  - no email lookups, so accounts are never linked by email.
 */
export function createAdapter(db: () => PrismaClient): Adapter {
  return {
    async createUser(data) {
      const { githubId, githubLogin, name, image } = data as AdapterUser & GitHubUserFields;
      const user = await db().$transaction(async (tx) => {
        const created = await tx.user.create({ data: { githubId, githubLogin, name, image } });
        await tx.workspace.create({
          data: {
            name: `${githubLogin}'s workspace`,
            memberships: { create: { userId: created.id, role: "OWNER" } },
          },
        });
        return created;
      });
      return toAdapterUser(user);
    },

    async getUser(id) {
      const user = await db().user.findUnique({ where: { id } });
      return user ? toAdapterUser(user) : null;
    },

    // Sign-in is GitHub-only, and we never link accounts by email.
    async getUserByEmail() {
      return null;
    },

    async getUserByAccount({ provider, providerAccountId }) {
      const account = await db().account.findUnique({
        where: { provider_providerAccountId: { provider, providerAccountId } },
        include: { user: true },
      });
      return account ? toAdapterUser(account.user) : null;
    },

    async updateUser(data) {
      const { id, name, image } = data;
      const user = await db().user.update({ where: { id }, data: { name, image } });
      return toAdapterUser(user);
    },

    async linkAccount(account: AdapterAccount) {
      // Keep only the identity link; drop every token Auth.js passes in.
      await db().account.create({
        data: {
          userId: account.userId,
          type: account.type,
          provider: account.provider,
          providerAccountId: account.providerAccountId,
        },
      });
    },

    async createSession({ sessionToken, userId, expires }) {
      await db().session.create({
        data: { sessionTokenHash: hashSessionToken(sessionToken), userId, expires },
      });
      return { sessionToken, userId, expires };
    },

    async getSessionAndUser(sessionToken) {
      const session = await db().session.findUnique({
        where: { sessionTokenHash: hashSessionToken(sessionToken) },
        include: { user: true },
      });
      if (!session) return null;
      return {
        session: { sessionToken, userId: session.userId, expires: session.expires },
        user: toAdapterUser(session.user),
      };
    },

    async updateSession({ sessionToken, expires }) {
      const updated = await db().session.updateMany({
        where: { sessionTokenHash: hashSessionToken(sessionToken) },
        data: expires ? { expires } : {},
      });
      if (updated.count === 0) return null;
      const session = await db().session.findUnique({ where: { sessionTokenHash: hashSessionToken(sessionToken) } });
      return session ? ({ sessionToken, userId: session.userId, expires: session.expires } as AdapterSession) : null;
    },

    // Returns the deleted session so the signOut event can record who signed out.
    async deleteSession(sessionToken) {
      const where = { sessionTokenHash: hashSessionToken(sessionToken) };
      const session = await db().session.findUnique({ where });
      if (!session) return null;
      await db().session.deleteMany({ where });
      return { sessionToken, userId: session.userId, expires: session.expires };
    },
  };
}
