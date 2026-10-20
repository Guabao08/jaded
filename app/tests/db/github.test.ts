import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdapterUser } from "next-auth/adapters";
import { createAdapter } from "@/lib/auth/adapter";
import { db } from "@/lib/db";
import type { GitHubClient } from "@/lib/github/client";
import { completeInstallation, InstallError } from "@/lib/github/install";
import { processGitHubEvent } from "@/lib/github/process";
import { receiveGitHubWebhook, type GitHubEventJob } from "@/lib/github/receive";
import { normalizePush, signBody } from "@/lib/github/webhook";
import { listWorkspacesForUser, workspaceScope } from "@/lib/workspaces";
import { pushPayload } from "../fixtures/github";
import { resetDatabase } from "./helpers";

const secret = "w".repeat(40);
const adapter = createAdapter(db);

async function newUser(githubId: number, login: string) {
  const user = await adapter.createUser!({
    id: "x",
    email: "",
    emailVerified: null,
    githubId: String(githubId),
    githubLogin: login,
  } as AdapterUser);
  const [workspace] = await listWorkspacesForUser(user.id);
  return { user, workspace };
}

function fakeGitHub(overrides: Partial<GitHubClient> = {}): GitHubClient {
  return {
    getInstallation: vi.fn(async (id: string) => ({ id: Number(id), account: { login: "alice", type: "User" } })),
    installationToken: vi.fn(async () => "ghs_short_lived"),
    listInstallationRepos: vi.fn(async () => [
      { id: 777, full_name: "alice/demo", private: false, default_branch: "main" },
    ]),
    getRepo: vi.fn(),
    pullsForCommit: vi.fn(async () => [
      { number: 12, title: "Dark mode", html_url: "https://github.com/alice/demo/pull/12", state: "closed" },
    ]),
    exchangeUserCode: vi.fn(async () => "ghu_user_token"),
    userInstallationIds: vi.fn(async () => ["5001"]),
    revokeUserToken: vi.fn(async () => {}),
    ...overrides,
  } as GitHubClient;
}

function webhook(body: string, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/github/webhook", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "x-github-event": "push",
      "x-github-delivery": "d-1",
      "x-hub-signature-256": signBody(secret, body),
      ...headers,
    },
  });
}

beforeEach(resetDatabase);

describe("webhook intake", () => {
  const body = JSON.stringify(pushPayload());

  function deps() {
    const enqueue = vi.fn(async (_job: GitHubEventJob) => {});
    return { enqueue, deps: { webhookSecret: secret, db, enqueue } };
  }

  it("rejects a bad signature with 401 and stores nothing", async () => {
    const { enqueue, deps: d } = deps();
    const res = await receiveGitHubWebhook(webhook(body, { "x-hub-signature-256": signBody("x".repeat(40), body) }), d);
    expect(res.status).toBe(401);
    const missing = webhook(body);
    missing.headers.delete("x-hub-signature-256");
    expect((await receiveGitHubWebhook(missing, d)).status).toBe(401);
    expect(enqueue).not.toHaveBeenCalled();
    expect(await db().webhookDelivery.count()).toBe(0);
  });

  it("rejects an oversized body with 413 before checking anything else", async () => {
    const { enqueue, deps: d } = deps();
    const big = JSON.stringify(pushPayload({ padding: "x".repeat(1_000_001) }));
    expect((await receiveGitHubWebhook(webhook(big), d)).status).toBe(413);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("accepts a signed push, records the delivery and queues one job", async () => {
    const { enqueue, deps: d } = deps();
    const res = await receiveGitHubWebhook(webhook(body), d);
    expect(res.status).toBe(202);
    expect(enqueue).toHaveBeenCalledTimes(1);
    const job = enqueue.mock.calls[0][0];
    expect(job).toMatchObject({ kind: "push", deliveryId: "d-1", push: { githubRepoId: "777" } });
    expect(JSON.stringify(job)).not.toContain("@example.com");
    expect(await db().webhookDelivery.count()).toBe(1);
  });

  it("ignores a replayed delivery", async () => {
    const { enqueue, deps: d } = deps();
    await receiveGitHubWebhook(webhook(body), d);
    const replay = await receiveGitHubWebhook(webhook(body), d);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ duplicate: true });
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("forgets the delivery if queueing fails, so GitHub's redelivery is processed", async () => {
    const { deps: d } = deps();
    const failing = { ...d, enqueue: vi.fn(async () => Promise.reject(new Error("db down"))) };
    expect((await receiveGitHubWebhook(webhook(body), failing)).status).toBe(500);
    expect(await db().webhookDelivery.count()).toBe(0);
    expect((await receiveGitHubWebhook(webhook(body), d)).status).toBe(202);
  });

  it("refuses everything while the App is not configured", async () => {
    const { deps: d } = deps();
    expect((await receiveGitHubWebhook(webhook(body), { ...d, webhookSecret: null })).status).toBe(503);
  });

  it("acknowledges a ping without queueing work", async () => {
    const { enqueue, deps: d } = deps();
    const ping = JSON.stringify({ zen: "Keep it logically awesome." });
    const res = await receiveGitHubWebhook(webhook(ping, { "x-github-event": "ping", "x-github-delivery": "p-1" }), d);
    expect(res.status).toBe(202);
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("installation linking", () => {
  it("links an installation the user can access and syncs its repositories", async () => {
    const { user, workspace } = await newUser(1001, "alice");
    const github = fakeGitHub();
    const audit = vi.fn(async () => {});
    await completeInstallation(
      { userId: user.id, workspaceId: workspace.id, installationId: "5001", code: "c" },
      { db, github, audit },
    );
    expect(await db().gitHubInstallation.findFirstOrThrow()).toMatchObject({
      workspaceId: workspace.id,
      accountLogin: "alice",
    });
    expect((await db().repository.findFirstOrThrow()).fullName).toBe("alice/demo");
    expect(github.revokeUserToken).toHaveBeenCalledWith("ghu_user_token");
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "github.installation_connected" }));
  });

  it("refuses an installation ID the user cannot access (forged callback)", async () => {
    const { user, workspace } = await newUser(1001, "alice");
    const github = fakeGitHub({ userInstallationIds: vi.fn(async () => ["9999"]) });
    const audit = vi.fn(async () => {});
    await expect(
      completeInstallation(
        { userId: user.id, workspaceId: workspace.id, installationId: "5001", code: "c" },
        { db, github, audit },
      ),
    ).rejects.toEqual(new InstallError("not_yours"));
    expect(await db().gitHubInstallation.count()).toBe(0);
    expect(github.revokeUserToken).toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "github.installation_rejected" }));
  });

  it("refuses to move an installation that belongs to another workspace", async () => {
    const a = await newUser(1001, "alice");
    const b = await newUser(1002, "bob");
    const github = fakeGitHub();
    await completeInstallation(
      { userId: a.user.id, workspaceId: a.workspace.id, installationId: "5001", code: "c" },
      { db, github, audit: async () => {} },
    );
    await expect(
      completeInstallation(
        { userId: b.user.id, workspaceId: b.workspace.id, installationId: "5001", code: "c" },
        { db, github, audit: async () => {} },
      ),
    ).rejects.toEqual(new InstallError("other_workspace"));
    expect((await db().gitHubInstallation.findFirstOrThrow()).workspaceId).toBe(a.workspace.id);
  });

  it("refuses a callback without a code or with a malformed installation ID", async () => {
    const { user, workspace } = await newUser(1001, "alice");
    const deps = { db, github: fakeGitHub(), audit: async () => {} };
    await expect(
      completeInstallation({ userId: user.id, workspaceId: workspace.id, installationId: "5001", code: null }, deps),
    ).rejects.toEqual(new InstallError("missing"));
    await expect(
      completeInstallation({ userId: user.id, workspaceId: workspace.id, installationId: "1 OR 1", code: "c" }, deps),
    ).rejects.toEqual(new InstallError("missing"));
  });
});

describe("push processing", () => {
  async function connected() {
    const owner = await newUser(1001, "alice");
    const github = fakeGitHub();
    await completeInstallation(
      { userId: owner.user.id, workspaceId: owner.workspace.id, installationId: "5001", code: "c" },
      { db, github, audit: async () => {} },
    );
    return { ...owner, github };
  }

  function pushJob(overrides: Record<string, unknown> = {}, deliveryId = "d-1"): GitHubEventJob {
    return { kind: "push", deliveryId, push: normalizePush(pushPayload(overrides))! };
  }

  it("turns a push to the default branch into an Update with linked PRs", async () => {
    const { workspace, github } = await connected();
    await processGitHubEvent(pushJob(), { db, github });
    const update = await db().update.findFirstOrThrow();
    expect(update).toMatchObject({ workspaceId: workspace.id, origin: "EXTERNAL_UNTRUSTED", afterSha: "b".repeat(40) });
    expect(update.pullRequests).toEqual([
      { number: 12, title: "Dark mode", url: "https://github.com/alice/demo/pull/12", state: "closed" },
    ]);
    expect(github.installationToken).toHaveBeenLastCalledWith("5001", [777]);
  });

  it("is idempotent when a job is retried", async () => {
    const { github } = await connected();
    await processGitHubEvent(pushJob(), { db, github });
    await processGitHubEvent(pushJob(), { db, github });
    expect(await db().update.count()).toBe(1);
  });

  it("still records the Update when the PR lookup fails", async () => {
    const { github } = await connected();
    const failing = { ...github, pullsForCommit: vi.fn(async () => Promise.reject(new Error("boom"))) };
    await processGitHubEvent(pushJob(), { db, github: failing });
    expect((await db().update.findFirstOrThrow()).pullRequests).toEqual([]);
  });

  it("ignores other branches, unknown repositories and suspended installations", async () => {
    const { github } = await connected();
    await processGitHubEvent(pushJob({ ref: "refs/heads/feature" }, "d-2"), { db, github });
    await processGitHubEvent(pushJob({ repository: { id: 999, full_name: "eve/other" } }, "d-3"), { db, github });
    await processGitHubEvent(
      { kind: "installation", deliveryId: "d-4", action: "suspend", installationId: "5001" },
      { db, github },
    );
    await processGitHubEvent(pushJob({}, "d-5"), { db, github });
    expect(await db().update.count()).toBe(0);
  });

  it("deletes our copy when the App is uninstalled", async () => {
    const { github } = await connected();
    await processGitHubEvent(pushJob(), { db, github });
    await processGitHubEvent(
      { kind: "installation", deliveryId: "d-9", action: "deleted", installationId: "5001" },
      { db, github },
    );
    expect(await db().gitHubInstallation.count()).toBe(0);
    expect(await db().repository.count()).toBe(0);
    expect(await db().update.count()).toBe(0);
  });

  it("removes repositories taken out of the installation", async () => {
    const { github } = await connected();
    await processGitHubEvent(
      { kind: "installation_repositories", deliveryId: "d-6", installationId: "5001", added: [], removed: ["777"] },
      { db, github },
    );
    expect(await db().repository.count()).toBe(0);
  });
});

describe("workspace isolation for apps and repositories", () => {
  it("user A cannot read user B's apps or repositories", async () => {
    const a = await newUser(1001, "alice");
    const b = await newUser(1002, "bob");
    await completeInstallation(
      { userId: b.user.id, workspaceId: b.workspace.id, installationId: "5001", code: "c" },
      {
        db,
        github: fakeGitHub({
          getInstallation: vi.fn(async () => ({ id: 5001, account: { login: "bob", type: "User" } })),
        }),
        audit: async () => {},
      },
    );
    const bScope = (await workspaceScope(b.user.id, b.workspace.id))!;
    const bApp = await bScope.createApp("Bob's app");
    const bRepo = (await bScope.listRepositories())[0];

    const aScope = (await workspaceScope(a.user.id, a.workspace.id))!;
    expect(await aScope.getApp(bApp.id)).toBeNull();
    expect(await aScope.getRepository(bRepo.id)).toBeNull();
    expect(await aScope.listApps()).toEqual([]);
    expect(await aScope.listUpdates()).toEqual([]);
    expect(await workspaceScope(a.user.id, b.workspace.id)).toBeNull();
  });
});
