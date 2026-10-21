import { monthlyCapMicro, textProvider } from "./ai";
import { db } from "./db";
import { github } from "./github";
import { processGitHubEvent } from "./github/process";
import type { GitHubEventJob } from "./github/receive";
import { enqueue, jobs, QUEUES } from "./jobs";
import { log } from "./log";
import { createImageFetcher } from "./media/source-images";
import { mediaStorage } from "./media/storage";
import { createTemplateRenderer } from "./media/templates";
import { generatePostsForUpdate } from "./posts/generate";

interface GenerateJob {
  updateId: string;
  attempt?: number;
}

/** Queues post generation; `afterSeconds` delays it (used for rate-limit backoff). */
export async function queueGeneration(updateId: string, attempt = 1, afterSeconds?: number): Promise<void> {
  await enqueue(QUEUES.generatePosts, { updateId, attempt } satisfies GenerateJob, {
    singletonKey: `${updateId}:${attempt}`,
    ...(afterSeconds ? { startAfter: afterSeconds } : {}),
  });
}

export async function startWorkers(): Promise<void> {
  try {
    const queue = await jobs();
    await queue.work<GitHubEventJob>(QUEUES.githubEvent, async (batch) => {
      for (const job of batch) {
        await processGitHubEvent(job.data, {
          db,
          github: github()?.client ?? null,
          enqueueGeneration: (updateId) => queueGeneration(updateId),
        });
      }
    });
    const renderer = createTemplateRenderer();
    const fetchImage = createImageFetcher();
    await queue.work<GenerateJob>(QUEUES.generatePosts, async (batch) => {
      for (const job of batch) {
        const attempt = job.data.attempt ?? 1;
        const outcome = await generatePostsForUpdate(
          job.data.updateId,
          { db, provider: textProvider(), renderer, storage: mediaStorage(), fetchImage, capMicro: monthlyCapMicro() },
          attempt,
        );
        if (outcome.kind === "retry") await queueGeneration(job.data.updateId, attempt + 1, outcome.afterSeconds);
      }
    });
    log.info("background worker started");
  } catch (error) {
    // The site keeps working without the worker (for example, no database yet).
    log.error("background worker did not start", { error });
  }
}
