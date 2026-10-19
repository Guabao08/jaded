import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdapterUser } from "next-auth/adapters";
import { createAdapter, hashSessionToken } from "@/lib/auth/adapter";
import { revokePresentedSession } from "@/lib/auth/rotate";
import { SESSION_COOKIE } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { getWorkspaceForUser, listWorkspacesForUser } from "@/lib/workspaces";
import { resetDatabase } from "./helpers";

const adapter = createAdapter(db);

function githubUser(id: number, login: string) {
  return {
    id: "ignored",
    email: "",
    emailVerified: null,
    name: login,
    image: null,
    githubId: String(id),
    githubLogin: login,
  };
}

async function signUp(id: number, login: string) {
  const user = await adapter.createUser!(githubUser(id, login) as AdapterUser);
  await adapter.linkAccount!({
    userId: user.id,
    type: "oauth",
    provider: "github",
    providerAccountId: String(id),
    access_token: "gho_should_never_be_stored",
    refresh_token: "ghr_should_never_be_stored",
    token_type: "bearer",
    scope: "",
  });
  const [workspace] = await listWorkspacesForUser(user.id);
  return { user, workspace };
}

beforeEach(resetDatabase);

describe("new users", () => {
  it("get their own workspace as owner", async () => {
    const { user, workspace } = await signUp(1001, "alice");
    expect(workspace.name).toBe("alice's workspace");
    const membership = await db().membership.findFirstOrThrow({ where: { userId: user.id } });
    expect(membership).toMatchObject({ workspaceId: workspace.id, role: "OWNER" });
  });

  it("are found again by their GitHub account, not by email", async () => {
    const { user } = await signUp(1001, "alice");
    expect((await adapter.getUserByAccount!({ provider: "github", providerAccountId: "1001" }))?.id).toBe(user.id);
    expect(await adapter.getUserByEmail!("alice@example.com")).toBeNull();
  });

  it("never have OAuth tokens stored", async () => {
    await signUp(1001, "alice");
    const account = await db().account.findFirstOrThrow();
    expect(JSON.stringify(account)).not.toMatch(/should_never_be_stored/);
  });
});

describe("workspace isolation", () => {
  it("user A cannot load user B's workspace by ID", async () => {
    const a = await signUp(1001, "alice");
    const b = await signUp(1002, "bob");

    expect(await getWorkspaceForUser(a.user.id, a.workspace.id)).not.toBeNull();
    expect(await getWorkspaceForUser(a.user.id, b.workspace.id)).toBeNull();
    expect(await getWorkspaceForUser(b.user.id, a.workspace.id)).toBeNull();
    expect(await getWorkspaceForUser(a.user.id, "does-not-exist")).toBeNull();
  });

  it("lists only the user's own workspaces", async () => {
    const a = await signUp(1001, "alice");
    await signUp(1002, "bob");
    expect((await listWorkspacesForUser(a.user.id)).map((w) => w.id)).toEqual([a.workspace.id]);
  });
});

describe("database sessions", () => {
  it("are stored only as a hash of the token", async () => {
    const { user } = await signUp(1001, "alice");
    const token = "raw-session-token-value";
    await adapter.createSession!({ sessionToken: token, userId: user.id, expires: new Date(Date.now() + 60_000) });

    const row = await db().session.findFirstOrThrow();
    expect(row.sessionTokenHash).toBe(hashSessionToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
    expect((await adapter.getSessionAndUser!(token))?.user.id).toBe(user.id);
    expect(await adapter.getSessionAndUser!(row.sessionTokenHash)).toBeNull();
  });

  it("are deleted on sign-out", async () => {
    const { user } = await signUp(1001, "alice");
    await adapter.createSession!({ sessionToken: "t", userId: user.id, expires: new Date(Date.now() + 60_000) });
    const deleted = await adapter.deleteSession!("t");
    expect(deleted).toMatchObject({ userId: user.id });
    expect(await db().session.count()).toBe(0);
  });
});

describe("session rotation on login", () => {
  it("revokes the session presented at the OAuth callback", async () => {
    const { user } = await signUp(1001, "alice");
    await adapter.createSession!({ sessionToken: "old", userId: user.id, expires: new Date(Date.now() + 60_000) });
    await adapter.createSession!({
      sessionToken: "other-device",
      userId: user.id,
      expires: new Date(Date.now() + 60_000),
    });
    const audit = vi.fn(async () => {});

    const request = new Request("http://localhost/api/auth/callback/github?code=x", {
      headers: { cookie: `a=1; ${SESSION_COOKIE}=old` },
    });
    await revokePresentedSession(request, { db, audit });

    expect(await adapter.getSessionAndUser!("old")).toBeNull();
    expect(await adapter.getSessionAndUser!("other-device")).not.toBeNull();
    expect(audit).toHaveBeenCalledWith({ action: "auth.session_revoked_on_login", actorUserId: user.id });
  });

  it("does nothing without a session cookie", async () => {
    const audit = vi.fn(async () => {});
    await revokePresentedSession(new Request("http://localhost/api/auth/callback/github"), { db, audit });
    expect(audit).not.toHaveBeenCalled();
  });
});
