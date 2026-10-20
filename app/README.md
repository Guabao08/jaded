# Jaded app

The Jaded site and dashboard: Next.js (App Router) + TypeScript, Prisma on PostgreSQL, and pg-boss for background jobs. The build plan is in [`../PLAN.md`](../PLAN.md); security details are in [`../SECURITY.md`](../SECURITY.md).

## Run locally

Requires Node.js 20.12 or later.

```sh
cd app
npm install                 # also generates the Prisma client and enables the gitleaks pre-commit hook
cp .env.example .env
npm run keygen              # run twice: one for ENCRYPTION_MASTER_KEYS (as v1:<key>), one for AUTH_SECRET
npm run db:local            # in its own terminal: a local Postgres on port 5433 (data in app/.data/pg)
npm run db:migrate          # apply migrations
npm run dev                 # http://localhost:3000
```

Use `localhost`, not `127.0.0.1`, in `APP_URL`; the app refuses a loopback IP because Next.js rewrites it to `localhost`, which breaks sign-in redirects.

The app validates its environment when it starts (`dev`, `build` and `start`) and exits with a list of the missing or invalid variable names if anything is wrong.

### Sign-in (GitHub OAuth App)

Sign-in uses a GitHub OAuth App and asks for **no scopes**: Jaded reads only the public profile (numeric ID, login, name, avatar). It does not request email, and it does not keep the OAuth token, because repository access comes from the GitHub App in Phase 2.

1. github.com → Settings → Developer settings → OAuth Apps → New OAuth App.
2. Homepage URL: your `APP_URL`. Authorization callback URL: `<APP_URL>/api/auth/callback/github`.
3. Put the client ID and a generated client secret in `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET`.
4. Put your numeric GitHub user ID (the `id` field at `https://api.github.com/users/<login>`) in `AUTH_ALLOWED_GITHUB_IDS`. Numeric IDs are used because logins can be renamed and re-registered.

Use one OAuth App for local development and a separate one for staging.

### GitHub App (repository access and pushes)

Jaded reads repositories through a GitHub App, not the sign-in OAuth App. Create one per environment (local, staging, production) under the `jaded-app` organization: Organization settings → Developer settings → GitHub Apps → New GitHub App.

| Setting                                                | Value                                                                                          | Why                                                                                 |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| GitHub App name                                        | e.g. `Jaded (dev)`                                                                             | Shown to users when they install it                                                 |
| Homepage URL                                           | `APP_URL`                                                                                      |                                                                                     |
| Callback URL                                           | `<APP_URL>/api/github/callback`                                                                | Where GitHub returns users after installing                                         |
| Request user authorization (OAuth) during installation | **On**                                                                                         | Lets Jaded confirm the signed-in user can access the installation before linking it |
| Webhook URL                                            | `<APP_URL>/api/github/webhook`                                                                 | Must be public HTTPS (staging, or a temporary tunnel for local testing)             |
| Webhook secret                                         | output of `npm run keygen`                                                                     | Every delivery is signature-checked                                                 |
| Repository permissions                                 | Contents: **Read**, Metadata: **Read**, Pull requests: **Read**; everything else **No access** | Read commits and diffs, list repos, find the PR linked to a push                    |
| Account permissions                                    | none                                                                                           |                                                                                     |
| Subscribe to events                                    | **Push**                                                                                       | Installation events are sent automatically                                          |
| Where can it be installed                              | Only on this account, for now                                                                  | Public installs come with public signups                                            |

After creating it: note the App ID and the URL name (slug, from `github.com/apps/<slug>`), generate a client secret, and generate a private key (a `.pem` download). Base64-encode the key for `GITHUB_APP_PRIVATE_KEY`, for example in PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("jaded.private-key.pem"))`. Then delete the downloaded file. Installation tokens are created per task with read-only permissions and never stored.

Locally, everything except live webhooks works without a public URL. The tests send signed webhook payloads to the app directly (`tests/db/github.test.ts`, `e2e/github.spec.ts`).

### Staging (Render)

`../render.yaml` is a Render Blueprint for staging: a Node web service plus managed Postgres (no public access). It deploys `main` after CI passes and runs `prisma migrate deploy` before each deploy.

1. In Render: New → Blueprint → select this repository.
2. When prompted, enter the `sync: false` values in Render (they live only in Render's secret store): `APP_URL` (the service's `https://…onrender.com` URL), `ENCRYPTION_MASTER_KEYS` (`v1:<npm run keygen>`), `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `AUTH_ALLOWED_GITHUB_IDS`. `AUTH_SECRET` is generated by Render.
3. Create the staging OAuth App with callback `<APP_URL>/api/auth/callback/github`.
4. Confirm in the dashboard that the service is HTTPS-only and the database is encrypted at rest, and record it in `../SECURITY.md`.

## Checks

| Command                | What it does                              |
| ---------------------- | ----------------------------------------- |
| `npm run typecheck`    | Route types, then TypeScript (no emit)    |
| `npm run lint`         | ESLint                                    |
| `npm run format:check` | Prettier (`npm run format` to fix)        |
| `npm test`             | Vitest unit and database tests            |
| `npm run test:e2e`     | Playwright against a production build     |
| `npm audit`            | CI fails on any high or critical advisory |

`npm test` and `npm run test:e2e` start their own throwaway Postgres (`scripts/pg.mjs`, from the `embedded-postgres` package), so no database setup is needed. `npm run test:e2e` needs `npm run build` first and signs in through a fake GitHub (`e2e/mock-github.mjs`). It uses Playwright's Chromium (`npx playwright install chromium`); to use an installed browser instead, set `PW_CHANNEL=msedge` or `PW_CHANNEL=chrome`.

CI (`.github/workflows/`) runs all of the above, plus a gitleaks scan of the full history and CodeQL, on every push.

## Layout

- `src/lib/env.ts`: startup environment validation (zod).
- `src/lib/crypto/`: envelope encryption for sensitive fields (AES-256-GCM, per-value data keys, versioned master keys, rotation).
- `src/lib/log/`: structured JSON logger with mandatory redaction.
- `src/lib/security-headers.ts` and `src/proxy.ts`: security headers, nonce-based CSP, HTTPS enforcement.
- `src/lib/db.ts`, `src/lib/jobs.ts`: lazily created Prisma client and pg-boss queue.
- `src/auth.ts`, `src/lib/auth/`: Auth.js (GitHub sign-in, database sessions, allowlist), our adapter (hashed session tokens, no OAuth tokens stored), and session rotation on login.
- `src/lib/workspaces.ts`: workspace queries, always scoped to the signed-in user's memberships.
- `src/lib/audit.ts`: audit log writes (sign-in, denied sign-in, sign-out, session revocation).
- `src/lib/github/`: GitHub App client (app JWT, short-lived installation tokens), webhook intake (signature, size cap, replay check, quick 202), background processing of pushes into Updates, and install linking.
- `src/lib/stores/`: App Store and Google Play listing import.
- `src/lib/worker.ts`, `src/instrumentation.ts`: the pg-boss worker, started with the server (set `JOBS_WORKER=off` to disable).
- `src/app/w/[workspaceId]/`: the dashboard: overview, apps (repository, listing, brand profile and voice), updates.
- `prisma/`: schema and migrations. The generated client goes to `src/generated/` (git-ignored).
- `tests/unit/`, `tests/db/`, `e2e/`: Vitest unit and database tests, and Playwright tests.

Next.js 16 calls middleware "proxy", so the request middleware lives in `src/proxy.ts`.
