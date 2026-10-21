import Link from "next/link";
import type { PushCommit } from "@/lib/github/webhook";
import { regeneratePosts, setUpdateDecision } from "./actions";

interface UpdateRow {
  id: string;
  afterSha: string;
  pusherLogin: string | null;
  compareUrl: string | null;
  commits: unknown;
  pullRequests: unknown;
  pushedAt: Date;
  repository: { fullName: string };
  decision: "PENDING" | "POST" | "SKIP";
  decisionReason: string | null;
  generationStatus: string;
  generationNote: string | null;
  _count?: { posts: number };
}

const STATUS_LABEL: Record<string, string> = {
  QUEUED: "Writing posts soon",
  GENERATING: "Writing posts…",
  RATE_LIMITED: "Waiting for the AI service",
  CAPPED: "Monthly AI budget reached",
  NOT_CONFIGURED: "Post writing not set up",
  NEEDS_APP: "Needs an app",
  DONE: "Drafts ready",
  FAILED: "Couldn't write posts",
};

const DECISION_LABEL = { POST: "Worth a post", SKIP: "Skipped", PENDING: "Not decided" } as const;

// Commit messages and PR titles are untrusted text from GitHub. React escapes
// them, and links are only rendered for https URLs built or checked on intake.
export function UpdateList({
  updates,
  empty,
  workspaceId,
}: {
  updates: UpdateRow[];
  empty: string;
  workspaceId: string;
}) {
  if (updates.length === 0) return <p>{empty}</p>;
  return (
    <ul className="updates">
      {updates.map((update) => {
        const commits = (update.commits as PushCommit[]) ?? [];
        const pulls = (update.pullRequests as Array<{ number: number; title: string; url: string }>) ?? [];
        const posts = update._count?.posts ?? 0;
        return (
          <li key={update.id} className="update">
            <p className="label">
              {update.repository.fullName} · <span className="mono">{update.afterSha.slice(0, 7)}</span> ·{" "}
              <time dateTime={update.pushedAt.toISOString()}>{update.pushedAt.toUTCString()}</time>
              {update.pusherLogin ? ` · pushed by ${update.pusherLogin}` : ""}
            </p>
            <ul className="commits">
              {commits.map((c) => (
                <li key={c.sha}>
                  {c.url ? (
                    <a href={c.url} rel="noreferrer noopener" target="_blank" className="mono">
                      {c.sha.slice(0, 7)}
                    </a>
                  ) : (
                    <span className="mono">{c.sha.slice(0, 7)}</span>
                  )}{" "}
                  {c.title}
                </li>
              ))}
            </ul>
            {pulls.length > 0 && (
              <p>
                Pull requests:{" "}
                {pulls.map((p, i) => (
                  <span key={p.number}>
                    {i > 0 && ", "}
                    <a href={p.url} rel="noreferrer noopener" target="_blank">
                      #{p.number} {p.title}
                    </a>
                  </span>
                ))}
              </p>
            )}
            {update.compareUrl && (
              <p>
                <a href={update.compareUrl} rel="noreferrer noopener" target="_blank">
                  Compare on GitHub
                </a>
              </p>
            )}

            <div className="decision">
              <p>
                <strong>{DECISION_LABEL[update.decision]}</strong>
                {update.decisionReason ? ` · ${update.decisionReason}` : ""}
              </p>
              {update.decision === "POST" && update.generationStatus !== "NOT_STARTED" && (
                <p className="status" role="status">
                  {STATUS_LABEL[update.generationStatus] ?? update.generationStatus}
                  {update.generationNote ? `: ${update.generationNote}` : ""}
                </p>
              )}
              <div className="actions">
                {posts > 0 && (
                  <Link className="button" href={`/w/${workspaceId}/posts#update-${update.id}`}>
                    View {posts} drafts
                  </Link>
                )}
                {update.decision !== "POST" && (
                  <form action={setUpdateDecision.bind(null, workspaceId, update.id, "POST")}>
                    <button className="button button-ghost" type="submit">
                      Post about this anyway
                    </button>
                  </form>
                )}
                {update.decision === "POST" && (
                  <form action={regeneratePosts.bind(null, workspaceId, update.id)}>
                    <button className="button button-ghost" type="submit">
                      Generate again
                    </button>
                  </form>
                )}
                {update.decision !== "SKIP" && (
                  <form action={setUpdateDecision.bind(null, workspaceId, update.id, "SKIP")}>
                    <button className="button button-ghost" type="submit">
                      Skip
                    </button>
                  </form>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
