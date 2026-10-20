import { db } from "@/lib/db";
import { env, githubAppEnv } from "@/lib/env";
import { receiveGitHubWebhook } from "@/lib/github/receive";
import { enqueue, QUEUES } from "@/lib/jobs";

export async function POST(request: Request) {
  return receiveGitHubWebhook(request, {
    webhookSecret: githubAppEnv(env())?.webhookSecret ?? null,
    db,
    enqueue: (job) => enqueue(QUEUES.githubEvent, job, { singletonKey: job.deliveryId }),
  });
}
