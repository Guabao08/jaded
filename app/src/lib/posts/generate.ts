import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { buildPrompt } from "../ai/prompt";
import { estimateCostMicro, formatUsd, monthlySpendMicro, usageMonth } from "../ai/cost";
import {
  AiNotConfiguredError,
  AiUnavailableError,
  RateLimitedError,
  type GeneratedPosts,
  type PostWritingInput,
  type TextProvider,
} from "../ai/types";
import { AiOutputError, validateGeneratedPosts } from "../ai/validate";
import { log } from "../log";
import type { PushCommit } from "../github/webhook";
import type { MediaStorage } from "../media/storage";
import { dominantColor, type ImageFetcher } from "../media/source-images";
import { PLATFORM_IMAGES, type ImageRenderer } from "../media/templates";

/**
 * Turns one Update into draft posts: checks the budget, asks the text
 * provider for per-platform copy, validates it, renders template images,
 * stores them privately and saves Post + Media records as drafts.
 */

export const PLATFORMS: PostWritingInput["platforms"] = ["INSTAGRAM", "FACEBOOK"];
const DEFAULT_COLOR = "#153b39";
const MAX_ATTEMPTS = 6;

export interface GenerateDeps {
  db: () => PrismaClient;
  provider: TextProvider | null;
  renderer: ImageRenderer;
  storage: MediaStorage;
  fetchImage: ImageFetcher;
  capMicro: number;
  now?: () => Date;
}

export type GenerateOutcome =
  | { kind: "done"; posts: number }
  | { kind: "skipped"; reason: string }
  | { kind: "retry"; afterSeconds: number }
  | { kind: "stopped"; status: "NEEDS_APP" | "CAPPED" | "NOT_CONFIGURED" | "FAILED" };

export async function generatePostsForUpdate(
  updateId: string,
  deps: GenerateDeps,
  attempt = 1,
): Promise<GenerateOutcome> {
  const now = deps.now ?? (() => new Date());
  const db = deps.db;
  const update = await db().update.findUnique({
    where: { id: updateId },
    include: { repository: { include: { apps: { include: { brandProfile: true }, orderBy: { createdAt: "asc" } } } } },
  });
  if (!update) return { kind: "skipped", reason: "update not found" };
  if (update.decision !== "POST") return { kind: "skipped", reason: "update is not marked for posting" };

  const setStatus = (
    generationStatus: "NEEDS_APP" | "GENERATING" | "RATE_LIMITED" | "CAPPED" | "NOT_CONFIGURED" | "DONE" | "FAILED",
    generationNote: string | null,
  ) => db().update.update({ where: { id: update.id }, data: { generationStatus, generationNote } });

  const app = update.repository.apps[0];
  if (!app) {
    await setStatus(
      "NEEDS_APP",
      `Link ${update.repository.fullName} to an app (Apps → your app → Repository) to generate posts.`,
    );
    return { kind: "stopped", status: "NEEDS_APP" };
  }
  if (!deps.provider) {
    await setStatus("NOT_CONFIGURED", "Post writing isn't set up yet: add GEMINI_API_KEY to app/.env and restart.");
    return { kind: "stopped", status: "NOT_CONFIGURED" };
  }

  const spent = await monthlySpendMicro(db, update.workspaceId, now());
  if (spent >= deps.capMicro) {
    await setStatus(
      "CAPPED",
      `This workspace reached its ${formatUsd(deps.capMicro)} AI budget for ${usageMonth(now())} (estimated). Generation resumes next month, or raise AI_MONTHLY_CAP_USD.`,
    );
    return { kind: "stopped", status: "CAPPED" };
  }

  await setStatus("GENERATING", null);
  const profile = app.brandProfile;
  const input: PostWritingInput = {
    app: {
      name: profile?.name || app.name,
      category: profile?.category ?? null,
      description: profile?.description ?? "",
      descriptionTrusted: profile?.origin !== "EXTERNAL_UNTRUSTED",
    },
    voice: {
      tone: profile?.tone ?? null,
      audience: profile?.audience ?? null,
      wordsToAvoid: profile?.wordsToAvoid ?? [],
    },
    change: {
      repository: update.repository.fullName,
      commits: ((update.commits as unknown as PushCommit[]) ?? []).map((c) => ({ title: c.title, message: c.message })),
      pullRequests: ((update.pullRequests as unknown as Array<{ title: string }>) ?? []).map((p) => ({
        title: p.title,
      })),
    },
    platforms: PLATFORMS,
  };

  let written: GeneratedPosts;
  try {
    written = await writeWithOneRetry(input, update.workspaceId, deps, now);
  } catch (error) {
    if (error instanceof RateLimitedError) {
      if (attempt >= MAX_ATTEMPTS) {
        await setStatus("FAILED", "Gemini kept hitting its free-tier limit. Use “Generate again” later.");
        return { kind: "stopped", status: "FAILED" };
      }
      const wait = error.daily ? 3600 : Math.min(Math.max(error.retryAfterSeconds, 30) * attempt, 1800);
      const at = new Date(now().getTime() + wait * 1000).toISOString().slice(11, 16);
      await setStatus(
        "RATE_LIMITED",
        error.daily
          ? `Gemini's free daily quota is used up. Trying again at ${at} UTC (or enable billing in Google AI Studio).`
          : `Gemini's free-tier rate limit was reached. Trying again at about ${at} UTC.`,
      );
      return { kind: "retry", afterSeconds: wait };
    }
    if (error instanceof AiUnavailableError && attempt < MAX_ATTEMPTS) {
      await setStatus("RATE_LIMITED", `${error.message} Trying again shortly.`);
      return { kind: "retry", afterSeconds: 30 * attempt };
    }
    if (error instanceof AiNotConfiguredError) {
      await setStatus("NOT_CONFIGURED", error.message);
      return { kind: "stopped", status: "NOT_CONFIGURED" };
    }
    if (error instanceof AiOutputError) {
      log.warn("generated posts failed checks", { updateId, problems: error.problems });
      await setStatus(
        "FAILED",
        `The AI's draft failed our safety checks twice (${error.problems.slice(0, 3).join("; ")}). Nothing was saved.`,
      );
      return { kind: "stopped", status: "FAILED" };
    }
    log.error("post generation failed", { updateId, error });
    await setStatus("FAILED", "Something went wrong while writing posts. Use “Generate again” to retry.");
    return { kind: "stopped", status: "FAILED" };
  }

  // Images: the app's own icon and screenshots in templates.
  const [icon, screenshot] = await Promise.all([
    profile?.iconUrl ? deps.fetchImage(profile.iconUrl) : Promise.resolve(null),
    profile?.screenshots?.[0] ? deps.fetchImage(profile.screenshots[0]) : Promise.resolve(null),
  ]);
  const brandColor = profile?.brandColor ?? dominantColor(icon) ?? DEFAULT_COLOR;

  const storedKeys: string[] = [];
  try {
    const drafts: Array<{ id: string; post: GeneratedPosts["posts"][number]; media: MediaDraft[] }> = [];
    for (const post of written.posts) {
      const postId = cuidLike();
      const media: MediaDraft[] = [];
      for (const [position, layout] of PLATFORM_IMAGES[post.platform].entries()) {
        const image = await deps.renderer.render({
          template: layout.template,
          width: layout.width,
          height: layout.height,
          appName: input.app.name,
          headline: post.headline,
          highlights: written.highlights,
          brandColor,
          icon,
          screenshot,
        });
        const mediaId = cuidLike();
        const key = `${update.workspaceId}/${postId}/${mediaId}.png`.toLowerCase();
        await deps.storage.put(key, image.png, image.contentType);
        storedKeys.push(key);
        media.push({
          id: mediaId,
          storageKey: key,
          contentType: image.contentType,
          width: image.width,
          height: image.height,
          bytes: image.png.byteLength,
          generator: image.generator,
          // The headline on the image is AI-written, so the image counts as AI content.
          aiGenerated: true,
          position,
        });
      }
      drafts.push({ id: postId, post, media });
    }

    const oldMedia = await db().media.findMany({
      where: { post: { updateId: update.id } },
      select: { storageKey: true },
    });
    await db().$transaction(async (tx) => {
      await tx.post.deleteMany({ where: { updateId: update.id } });
      for (const draft of drafts) {
        await tx.post.create({
          data: {
            id: draft.id,
            workspaceId: update.workspaceId,
            updateId: update.id,
            appId: app.id,
            platform: draft.post.platform,
            status: "DRAFT",
            caption: draft.post.caption,
            hashtags: draft.post.hashtags,
            altText: draft.post.altText,
            headline: draft.post.headline,
            aiGenerated: true,
            aiProvider: deps.provider!.name,
            aiModel: deps.provider!.model,
            media: { create: draft.media },
          },
        });
      }
      await tx.update.update({
        where: { id: update.id },
        data: { generationStatus: "DONE", generationNote: `${drafts.length} draft posts ready for review.` },
      });
    });
    await Promise.all(oldMedia.map((m) => deps.storage.delete(m.storageKey).catch(() => undefined)));
    return { kind: "done", posts: drafts.length };
  } catch (error) {
    await Promise.all(storedKeys.map((k) => deps.storage.delete(k).catch(() => undefined)));
    log.error("saving generated posts failed", { updateId, error });
    await setStatus("FAILED", "Something went wrong while making images. Use “Generate again” to retry.");
    return { kind: "stopped", status: "FAILED" };
  }
}

/** Calls the provider, records usage, validates; asks once more if the reply fails checks. */
async function writeWithOneRetry(
  input: PostWritingInput,
  workspaceId: string,
  deps: GenerateDeps,
  now: () => Date,
): Promise<GeneratedPosts> {
  const provider = deps.provider!;
  const prompt = buildPrompt(input);
  let lastError: AiOutputError | undefined;
  for (let i = 0; i < 2; i++) {
    const result = await provider.writePosts(prompt, input);
    await deps.db().aiUsage.create({
      data: {
        workspaceId,
        month: usageMonth(now()),
        provider: result.provider,
        model: result.model,
        purpose: "post_text",
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        estimatedCostMicro: estimateCostMicro(result.model, result.usage),
      },
    });
    try {
      return validateGeneratedPosts(result.raw, input);
    } catch (error) {
      if (!(error instanceof AiOutputError)) throw error;
      lastError = error;
    }
  }
  throw lastError!;
}

interface MediaDraft {
  id: string;
  storageKey: string;
  contentType: string;
  width: number;
  height: number;
  bytes: number;
  generator: string;
  aiGenerated: boolean;
  position: number;
}

function cuidLike(): string {
  return `c${Date.now().toString(36)}${randomBytes(8).toString("hex")}`;
}
