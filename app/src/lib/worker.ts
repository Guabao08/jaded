import { db } from "./db";
import { github } from "./github";
import { processGitHubEvent } from "./github/process";
import type { GitHubEventJob } from "./github/receive";
import { jobs, QUEUES } from "./jobs";
import { log } from "./log";

export async function startWorkers(): Promise<void> {
  try {
    const queue = await jobs();
    await queue.work<GitHubEventJob>(QUEUES.githubEvent, async (batch) => {
      for (const job of batch) {
        await processGitHubEvent(job.data, { db, github: github()?.client ?? null });
      }
    });
    log.info("background worker started");
  } catch (error) {
    // The site keeps working without the worker (for example, no database yet).
    log.error("background worker did not start", { error });
  }
}
