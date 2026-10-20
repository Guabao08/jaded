// Synthetic GitHub payloads shaped like real ones (only the fields Jaded reads, plus a few it must drop).

export function pushPayload(overrides: Record<string, unknown> = {}) {
  const sha = "b".repeat(40);
  return {
    ref: "refs/heads/main",
    before: "a".repeat(40),
    after: sha,
    created: false,
    deleted: false,
    forced: false,
    compare: "https://github.com/alice/demo/compare/aaa...bbb",
    commits: [
      {
        id: sha,
        message: "Add dark mode\n\nUsers can now switch themes in Settings.",
        timestamp: "2026-10-19T12:00:00Z",
        url: `https://github.com/alice/demo/commit/${sha}`,
        author: { name: "Alice", email: "alice@example.com", username: "alice" },
        committer: { name: "Alice", email: "alice@example.com", username: "alice" },
      },
    ],
    head_commit: { id: sha, timestamp: "2026-10-19T12:00:00Z" },
    repository: {
      id: 777,
      full_name: "alice/demo",
      html_url: "https://github.com/alice/demo",
      private: false,
      default_branch: "main",
    },
    pusher: { name: "alice", email: "alice@example.com" },
    sender: { login: "alice", id: 1001 },
    installation: { id: 5001 },
    ...overrides,
  };
}
