import type { PrismaClient } from "@/generated/prisma/client";
import { log } from "../log";
import { decideUpdate } from "../posts/decide";
import type { GitHubClient } from "./client";
import type { GitHubEventJob } from "./receive";

export interface ProcessDeps {
  db: () => PrismaClient;
  github: GitHubClient | null;
  /** Queues post generation for an Update marked POST. */
  enqueueGeneration?: (updateId: string) => Promise<void>;
}

/** Runs one queued GitHub event. Safe to retry: every write is idempotent. */
export async function processGitHubEvent(job: GitHubEventJob, deps: ProcessDeps): Promise<void> {
  if (job.kind === "push") return processPush(job, deps);
  if (job.kind === "installation") return processInstallation(job, deps);
  return processInstallationRepositories(job, deps);
}

async function processPush(job: Extract<GitHubEventJob, { kind: "push" }>, deps: ProcessDeps) {
  const { push } = job;
  const repo = await deps.db().repository.findUnique({
    where: { githubRepoId: push.githubRepoId },
    include: { installation: true },
  });
  if (!repo || repo.installation.suspendedAt) return; // Not connected to any workspace.
  if (push.ref !== `refs/heads/${repo.defaultBranch}`) return; // Only the default branch becomes an Update.

  const pullRequests = await linkedPullRequests(repo.installation.installationId, repo, push.commits, deps);
  const { decision, reason } = decideUpdate({ pusherLogin: push.pusherLogin, commits: push.commits });

  const existing = await deps.db().update.findUnique({ where: { deliveryId: job.deliveryId }, select: { id: true } });
  if (existing) return; // Retried job: already recorded.
  const created = await deps.db().update.create({
    data: {
      workspaceId: repo.workspaceId,
      repositoryId: repo.id,
      deliveryId: job.deliveryId,
      ref: push.ref,
      beforeSha: push.beforeSha,
      afterSha: push.afterSha,
      pusherLogin: push.pusherLogin,
      compareUrl: push.compareUrl,
      commits: push.commits as object[],
      pullRequests,
      pushedAt: new Date(push.pushedAt),
      decision,
      decisionReason: reason,
      generationStatus: decision === "POST" ? "QUEUED" : "NOT_STARTED",
    },
  });
  if (decision === "POST" && deps.enqueueGeneration) await deps.enqueueGeneration(created.id);
}

async function linkedPullRequests(
  installationId: string,
  repo: { githubRepoId: string; fullName: string },
  commits: Array<{ sha: string }>,
  deps: ProcessDeps,
) {
  if (!deps.github || commits.length === 0) return [];
  try {
    const token = await deps.github.installationToken(installationId, [Number(repo.githubRepoId)]);
    const shas = [...new Set(commits.slice(-3).map((c) => c.sha))];
    const results = await Promise.all(shas.map((sha) => deps.github!.pullsForCommit(token, repo.fullName, sha)));
    const unique = new Map<number, { number: number; title: string; url: string; state: string }>();
    for (const pull of results.flat()) {
      if (!pull?.number || !String(pull.html_url).startsWith("https://")) continue;
      unique.set(pull.number, {
        number: pull.number,
        title: String(pull.title ?? "").slice(0, 200),
        url: pull.html_url,
        state: String(pull.state ?? "").slice(0, 20),
      });
    }
    return [...unique.values()].slice(0, 5);
  } catch (error) {
    // PR links are a nice-to-have; the Update is still recorded without them.
    log.warn("could not look up pull requests for push", { repo: repo.fullName, error });
    return [];
  }
}

async function processInstallation(job: Extract<GitHubEventJob, { kind: "installation" }>, deps: ProcessDeps) {
  const where = { installationId: job.installationId };
  if (job.action === "deleted") {
    // Uninstalled on GitHub: delete our copy of the connection and its repositories.
    await deps.db().gitHubInstallation.deleteMany({ where });
  } else if (job.action === "suspend") {
    await deps.db().gitHubInstallation.updateMany({ where, data: { suspendedAt: new Date() } });
  } else if (job.action === "unsuspend") {
    await deps.db().gitHubInstallation.updateMany({ where, data: { suspendedAt: null } });
  }
}

async function processInstallationRepositories(
  job: Extract<GitHubEventJob, { kind: "installation_repositories" }>,
  deps: ProcessDeps,
) {
  const installation = await deps.db().gitHubInstallation.findUnique({ where: { installationId: job.installationId } });
  if (!installation) return;
  if (job.removed.length) {
    await deps.db().repository.deleteMany({
      where: { installationId: installation.id, githubRepoId: { in: job.removed } },
    });
  }
  if (job.added.length && deps.github) await syncRepositories(installation, deps.github, deps.db);
}

/** Mirrors the installation's repository list into our database. */
export async function syncRepositories(
  installation: { id: string; workspaceId: string; installationId: string },
  github: GitHubClient,
  db: () => PrismaClient,
) {
  const token = await github.installationToken(installation.installationId);
  const repos = await github.listInstallationRepos(token);
  for (const repo of repos) {
    await db().repository.upsert({
      where: { githubRepoId: String(repo.id) },
      update: { fullName: repo.full_name, private: repo.private, defaultBranch: repo.default_branch },
      create: {
        workspaceId: installation.workspaceId,
        installationId: installation.id,
        githubRepoId: String(repo.id),
        fullName: repo.full_name,
        private: repo.private,
        defaultBranch: repo.default_branch,
      },
    });
  }
  await db().repository.deleteMany({
    where: { installationId: installation.id, githubRepoId: { notIn: repos.map((r) => String(r.id)) } },
  });
}
