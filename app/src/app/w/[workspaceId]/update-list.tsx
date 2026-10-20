import type { PushCommit } from "@/lib/github/webhook";

interface UpdateRow {
  id: string;
  afterSha: string;
  pusherLogin: string | null;
  compareUrl: string | null;
  commits: unknown;
  pullRequests: unknown;
  pushedAt: Date;
  repository: { fullName: string };
}

// Commit messages and PR titles are untrusted text from GitHub. React escapes
// them, and links are only rendered for https URLs built or checked on intake.
export function UpdateList({ updates, empty }: { updates: UpdateRow[]; empty: string }) {
  if (updates.length === 0) return <p>{empty}</p>;
  return (
    <ul className="updates">
      {updates.map((update) => {
        const commits = (update.commits as PushCommit[]) ?? [];
        const pulls = (update.pullRequests as Array<{ number: number; title: string; url: string }>) ?? [];
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
              <a href={update.compareUrl} rel="noreferrer noopener" target="_blank">
                Compare on GitHub
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}
