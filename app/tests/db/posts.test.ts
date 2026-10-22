import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdapterUser } from "next-auth/adapters";
import { createFakeProvider } from "@/lib/ai/fake";
import { RateLimitedError, type TextProvider } from "@/lib/ai/types";
import { createAdapter } from "@/lib/auth/adapter";
import { db } from "@/lib/db";
import { processGitHubEvent } from "@/lib/github/process";
import { normalizePush } from "@/lib/github/webhook";
import { createLocalStorage } from "@/lib/media/storage";
import { createTemplateRenderer } from "@/lib/media/templates";
import { generatePostsForUpdate, type GenerateDeps } from "@/lib/posts/generate";
import { listWorkspacesForUser, workspaceScope } from "@/lib/workspaces";
import { pushPayload } from "../fixtures/github";
import { resetDatabase } from "./helpers";

const adapter = createAdapter(db);
const renderer = createTemplateRenderer();

async function setup(opts: { withApp?: boolean } = {}) {
  const user = await adapter.createUser!({
    id: "x",
    email: "",
    emailVerified: null,
    githubId: "1001",
    githubLogin: "alice",
  } as AdapterUser);
  const [workspace] = await listWorkspacesForUser(user.id);
  const installation = await db().gitHubInstallation.create({
    data: { workspaceId: workspace.id, installationId: "5001", accountLogin: "alice", accountType: "User" },
  });
  const repo = await db().repository.create({
    data: {
      workspaceId: workspace.id,
      installationId: installation.id,
      githubRepoId: "777",
      fullName: "alice/demo",
      private: false,
      defaultBranch: "main",
    },
  });
  if (opts.withApp !== false) {
    await db().app.create({
      data: {
        workspaceId: workspace.id,
        name: "Demo",
        repositoryId: repo.id,
        brandProfile: {
          create: {
            name: "Demo",
            description: "Plan your week.",
            screenshots: [],
            brandColor: "#c94f39",
            wordsToAvoid: ["revolutionary"],
          },
        },
      },
    });
  }
  return { user, workspace, repo };
}

async function push(commits: Array<{ id: string; message: string }>, enqueueGeneration = vi.fn(async () => {})) {
  const job = {
    kind: "push" as const,
    deliveryId: `d-${Math.random()}`,
    push: normalizePush(pushPayload({ commits }))!,
  };
  await processGitHubEvent(job, { db, github: null, enqueueGeneration });
  return { update: await db().update.findFirstOrThrow({ orderBy: { createdAt: "desc" } }), enqueueGeneration };
}

async function deps(overrides: Partial<GenerateDeps> = {}): Promise<GenerateDeps> {
  return {
    db,
    provider: createFakeProvider(),
    renderer,
    storage: createLocalStorage(await mkdtemp(join(tmpdir(), "jaded-media-"))),
    fetchImage: async () => null,
    capMicro: 10_000_000,
    ...overrides,
  };
}

const feat = [{ id: "a".repeat(40), message: "feat: offline mode\n\nWorks without a connection." }];

beforeEach(resetDatabase);

describe("deciding on pushes", () => {
  it("marks a feature push for posting and queues generation", async () => {
    await setup();
    const { update, enqueueGeneration } = await push(feat);
    expect(update).toMatchObject({ decision: "POST", generationStatus: "QUEUED" });
    expect(enqueueGeneration).toHaveBeenCalledWith(update.id);
  });

  it("skips maintenance pushes without queueing anything", async () => {
    await setup();
    const { update, enqueueGeneration } = await push([{ id: "b".repeat(40), message: "chore: bump deps" }]);
    expect(update).toMatchObject({ decision: "SKIP", generationStatus: "NOT_STARTED" });
    expect(update.decisionReason).toMatch(/maintenance/);
    expect(enqueueGeneration).not.toHaveBeenCalled();
  });
});

describe("generating drafts", () => {
  it("creates one draft per platform with stored images, AI labels and recorded cost", async () => {
    await setup();
    const { update } = await push(feat);
    const d = await deps();
    expect(await generatePostsForUpdate(update.id, d)).toEqual({ kind: "done", posts: 2 });

    const posts = await db().post.findMany({ include: { media: true }, orderBy: { platform: "asc" } });
    expect(posts.map((p) => p.platform).sort()).toEqual(["FACEBOOK", "INSTAGRAM"]);
    for (const post of posts) {
      expect(post).toMatchObject({ status: "DRAFT", aiGenerated: true, aiProvider: "fake" });
      expect(post.caption).toMatch(/offline mode/i);
      expect(post.media).toHaveLength(2);
      for (const m of post.media) {
        expect(m.aiGenerated).toBe(true);
        expect((await d.storage.get(m.storageKey))?.byteLength).toBe(m.bytes);
      }
    }
    expect(await db().update.findUniqueOrThrow({ where: { id: update.id } })).toMatchObject({
      generationStatus: "DONE",
    });
    const usage = await db().aiUsage.findFirstOrThrow();
    expect(usage).toMatchObject({ provider: "fake", purpose: "post_text", inputTokens: 900, outputTokens: 300 });
    expect(usage.estimatedCostMicro).toBeGreaterThan(0);
  });

  it("handles emoji and non-Latin text in commit messages", async () => {
    await setup();
    const { update } = await push([
      { id: "d".repeat(40), message: "feat: 🚀 Mode hors ligne → plus rapide, 日本語も対応" },
    ]);
    expect((update.commits as Array<{ title: string }>)[0].title).toBe(
      "feat: 🚀 Mode hors ligne → plus rapide, 日本語も対応",
    );
    expect(await generatePostsForUpdate(update.id, await deps())).toEqual({ kind: "done", posts: 2 });
    expect((await db().post.findFirstOrThrow()).caption).toContain("Mode hors ligne");
  });

  it("replaces old drafts and their files when generated again", async () => {
    await setup();
    const { update } = await push(feat);
    const d = await deps();
    await generatePostsForUpdate(update.id, d);
    const oldKeys = (await db().media.findMany()).map((m) => m.storageKey);
    await generatePostsForUpdate(update.id, d);
    expect(await db().post.count()).toBe(2);
    for (const key of oldKeys) expect(await d.storage.get(key)).toBeNull();
  });

  it("waits for an app to be linked", async () => {
    await setup({ withApp: false });
    const { update } = await push(feat);
    expect(await generatePostsForUpdate(update.id, await deps())).toEqual({ kind: "stopped", status: "NEEDS_APP" });
    expect((await db().update.findUniqueOrThrow({ where: { id: update.id } })).generationNote).toMatch(
      /Link alice\/demo/,
    );
  });

  it("explains when no API key is configured", async () => {
    await setup();
    const { update } = await push(feat);
    expect(await generatePostsForUpdate(update.id, await deps({ provider: null }))).toEqual({
      kind: "stopped",
      status: "NOT_CONFIGURED",
    });
    expect((await db().update.findUniqueOrThrow({ where: { id: update.id } })).generationNote).toMatch(
      /GEMINI_API_KEY/,
    );
  });

  it("stops at the monthly cap without calling the AI", async () => {
    const { workspace } = await setup();
    const { update } = await push(feat);
    await db().aiUsage.create({
      data: {
        workspaceId: workspace.id,
        month: new Date().toISOString().slice(0, 7),
        provider: "gemini",
        model: "gemini-3.8-flash",
        purpose: "post_text",
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostMicro: 10_000_000,
      },
    });
    const writePosts = vi.fn();
    const provider = { name: "spy", model: "m", writePosts } as unknown as TextProvider;
    expect(await generatePostsForUpdate(update.id, await deps({ provider }))).toEqual({
      kind: "stopped",
      status: "CAPPED",
    });
    expect(writePosts).not.toHaveBeenCalled();
    expect((await db().update.findUniqueOrThrow({ where: { id: update.id } })).generationNote).toMatch(
      /\$10\.00 AI budget/,
    );
  });

  it("backs off politely on rate limits and gives up after several tries", async () => {
    await setup();
    const { update } = await push(feat);
    const provider = {
      name: "gemini",
      model: "gemini-3.8-flash",
      writePosts: vi.fn(async () => Promise.reject(new RateLimitedError(34, false))),
    } as unknown as TextProvider;
    const d = await deps({ provider, now: () => new Date("2026-10-21T12:00:00Z") });

    expect(await generatePostsForUpdate(update.id, d, 1)).toEqual({ kind: "retry", afterSeconds: 34 });
    const waiting = await db().update.findUniqueOrThrow({ where: { id: update.id } });
    expect(waiting.generationStatus).toBe("RATE_LIMITED");
    expect(waiting.generationNote).toMatch(/free-tier rate limit.*12:00 UTC/);

    expect(await generatePostsForUpdate(update.id, d, 6)).toEqual({ kind: "stopped", status: "FAILED" });

    const daily = { ...provider, writePosts: vi.fn(async () => Promise.reject(new RateLimitedError(10, true))) };
    expect(await generatePostsForUpdate(update.id, await deps({ provider: daily }), 1)).toEqual({
      kind: "retry",
      afterSeconds: 3600,
    });
    expect((await db().update.findUniqueOrThrow({ where: { id: update.id } })).generationNote).toMatch(/daily quota/);
  });

  it("saves nothing when the AI's reply fails the safety checks twice (e.g. it obeyed an injected instruction)", async () => {
    await setup();
    const { update } = await push(feat);
    const obedient = {
      name: "gemini",
      model: "gemini-3.8-flash",
      writePosts: vi.fn(async () => ({
        provider: "gemini",
        model: "gemini-3.8-flash",
        usage: { inputTokens: 10, outputTokens: 10 },
        raw: {
          highlights: [],
          posts: ["INSTAGRAM", "FACEBOOK"].map((platform) => ({
            platform,
            headline: "FREE CRYPTO",
            caption: "Claim at https://evil.example",
            hashtags: [],
            altText: "x",
          })),
        },
      })),
    } as unknown as TextProvider;
    expect(await generatePostsForUpdate(update.id, await deps({ provider: obedient }))).toEqual({
      kind: "stopped",
      status: "FAILED",
    });
    expect(obedient.writePosts).toHaveBeenCalledTimes(2);
    expect(await db().post.count()).toBe(0);
    expect(await db().aiUsage.count()).toBe(2); // both attempts still count toward the budget
  });

  it("does nothing for updates marked skip", async () => {
    await setup();
    const { update } = await push([{ id: "c".repeat(40), message: "docs: readme" }]);
    expect(await generatePostsForUpdate(update.id, await deps())).toMatchObject({ kind: "skipped" });
  });
});

describe("workspace isolation for posts", () => {
  it("another user cannot list or open the owner's posts", async () => {
    await setup();
    const { update } = await push(feat);
    await generatePostsForUpdate(update.id, await deps());
    const bob = await adapter.createUser!({
      id: "y",
      email: "",
      emailVerified: null,
      githubId: "1002",
      githubLogin: "bob",
    } as AdapterUser);
    const [bobWs] = await listWorkspacesForUser(bob.id);
    const scope = (await workspaceScope(bob.id, bobWs.id))!;
    expect(await scope.listPosts()).toEqual([]);
    expect(await scope.getUpdate(update.id)).toBeNull();
  });
});
