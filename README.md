# ShipBrief

ShipBrief turns meaningful GitHub pushes into marketing drafts with commit evidence for a person to review. The app currently runs locally; GitHub App installation, hosting, and an AI provider are not configured.

## Run locally

Requires Node.js 20 or later. No package install is needed.

```sh
npm run dev
```

Then open http://localhost:4173.

## GitHub push intake

The server accepts signed GitHub `push` webhooks at `POST /api/github/webhook`. It verifies `X-Hub-Signature-256`, records delivery IDs to prevent duplicate drafts, saves commit/compare evidence, and creates a draft that appears in the inbox. Draft edits and approval status are saved on the server. Approval does not publish anything.

Set a webhook secret before starting the server:

```sh
GITHUB_WEBHOOK_SECRET='your-github-webhook-secret' npm run dev
```

In GitHub App settings, enable the webhook, subscribe to **Push**, use the same secret, and set the URL to the server's public HTTPS endpoint ending in `/api/github/webhook`. The local development server binds to `127.0.0.1`, so GitHub cannot deliver to it directly. A public HTTPS host is not configured yet. The dashboard API has no user authentication; keep this server local and do not expose it publicly before adding authentication and repository-level access controls.

Pull request associations are looked up for the pushed commits. Public repositories can return these associations without a token. For private repositories, set `GITHUB_API_TOKEN` to a token with read access to pull requests. The later GitHub App integration should replace this manually supplied token with an installation token.

```sh
GITHUB_WEBHOOK_SECRET='your-github-webhook-secret' \
GITHUB_API_TOKEN='your-read-only-token' \
npm run dev
```

## Data and current limits

- GitHub-originated repositories, runs, webhook delivery IDs, and drafts are stored in `.data/shipbrief.json` (or the path set with `SHIPBRIEF_DATA_FILE`).
- Existing sample data, workflows, brand voice settings, and manually created demo drafts still use browser `localStorage`.
- Push drafts use commit messages and linked GitHub evidence as source material. They use a conservative local template; LLM generation is not wired up.
- GitHub OAuth/App installation and repository selection are not implemented. Webhook secret verification is the only GitHub request authentication in the intake flow.
- GitHub publishing, server-side multi-user accounts, and production hosting are not implemented.
- Seed content and repository names are illustrative. They are not customer evidence or real integrations.
