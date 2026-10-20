import type { PrismaClient } from "@/generated/prisma/client";
import { log } from "../log";
import { hasValidSignature, normalizePush, PayloadTooLargeError, readLimitedBody, type GitHubPayload } from "./webhook";

export type GitHubEventJob =
  | { kind: "push"; deliveryId: string; push: NonNullable<ReturnType<typeof normalizePush>> }
  | { kind: "installation"; deliveryId: string; action: string; installationId: string }
  | {
      kind: "installation_repositories";
      deliveryId: string;
      installationId: string;
      added: string[];
      removed: string[];
    };

export interface ReceiveDeps {
  webhookSecret: string | null;
  db: () => PrismaClient;
  enqueue: (job: GitHubEventJob) => Promise<void>;
}

const json = (status: number, body: object) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

/**
 * Receives a GitHub webhook: size cap, signature check before parsing, replay
 * rejection by delivery ID, then a quick acknowledgement. The real work runs
 * as a background job.
 */
export async function receiveGitHubWebhook(request: Request, deps: ReceiveDeps): Promise<Response> {
  if (!deps.webhookSecret) return json(503, { error: "GitHub App is not configured" });

  let raw: Buffer;
  try {
    raw = await readLimitedBody(request);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return json(413, { error: "Payload too large" });
    throw error;
  }

  if (!hasValidSignature(deps.webhookSecret, raw, request.headers.get("x-hub-signature-256"))) {
    log.warn("github webhook rejected: bad signature");
    return json(401, { error: "Invalid signature" });
  }

  const deliveryId = request.headers.get("x-github-delivery")?.trim() ?? "";
  const event = request.headers.get("x-github-event")?.trim() ?? "";
  if (!/^[A-Za-z0-9-]{1,100}$/.test(deliveryId) || !/^[a-z_]{1,50}$/.test(event)) {
    return json(400, { error: "Missing delivery or event header" });
  }

  let payload: GitHubPayload;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    return json(400, { error: "Body must be JSON" });
  }

  const job = toJob(event, deliveryId, payload);

  // Record the delivery first; a duplicate (replay or GitHub redelivery) is ignored.
  try {
    await deps.db().webhookDelivery.create({ data: { deliveryId, event } });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return json(200, { ok: true, duplicate: true });
    throw error;
  }

  if (job) {
    try {
      await deps.enqueue(job);
    } catch (error) {
      // Forget the delivery so GitHub's redelivery is not mistaken for a replay.
      await deps.db().webhookDelivery.deleteMany({ where: { deliveryId } });
      log.error("github webhook could not be queued", { event, error });
      return json(500, { error: "Could not queue the event" });
    }
  }
  return json(202, { ok: true, queued: Boolean(job) });
}

function toJob(event: string, deliveryId: string, payload: GitHubPayload): GitHubEventJob | null {
  if (event === "push") {
    const push = normalizePush(payload);
    return push && !push.deleted ? { kind: "push", deliveryId, push } : null;
  }
  const installationId = payload?.installation?.id !== undefined ? String(payload.installation.id) : null;
  if (!installationId) return null;
  if (event === "installation") {
    return { kind: "installation", deliveryId, action: String(payload.action ?? ""), installationId };
  }
  if (event === "installation_repositories") {
    const ids = (list: unknown) => (Array.isArray(list) ? list.map((r) => String(r?.id)).filter(Boolean) : []);
    return {
      kind: "installation_repositories",
      deliveryId,
      installationId,
      added: ids(payload.repositories_added),
      removed: ids(payload.repositories_removed),
    };
  }
  return null; // ping and other events: acknowledged, nothing to do.
}
