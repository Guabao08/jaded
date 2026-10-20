# Security

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's **Report a vulnerability** button on this repository's Security tab (private vulnerability reporting). Do not open a public issue. Include what you found, how to reproduce it, and what it affects. We aim to reply within 3 working days and will tell you when it is fixed. Please give us a reasonable time to fix an issue before disclosing it.

Jaded is pre-launch and only its owner uses it, so there is no bug bounty yet.

## What we store

This section grows as features are built. Items marked _planned_ are not stored yet.

| Data | Why | Where | Protection |
| --- | --- | --- | --- |
| GitHub numeric ID, login, display name, avatar URL | Sign-in and showing who is signed in | Postgres (`User`) | Encrypted at rest by the database provider. No email is collected. |
| GitHub account link (provider + numeric ID only) | Find the user on their next sign-in | Postgres (`Account`) | OAuth access/refresh tokens from sign-in are discarded, never stored |
| Sign-in sessions | Keep users signed in | Postgres (`Session`), browser cookie | Cookie `__Secure-jaded.session`: `httpOnly`, `Secure`, `SameSite=Lax`, expires after 7 days. The database stores only a SHA-256 hash of the session token. Any session presented at login is revoked and a new one issued. |
| Workspaces and memberships | A private workspace per user | Postgres | Every read goes through the user's membership (`app/src/lib/workspaces.ts`); another user's workspace returns 404 |
| Audit log: sign-ins, denied sign-ins, sign-outs, session revocations, with IP and user agent | Security investigation | Postgres (`AuditLog`) | Metadata passes through the log redaction helper; only the app writes it |
| GitHub App installations and their repository list (installation ID, account login, repo ID, name, private flag, default branch) | Know which repos belong to a workspace | Postgres | No GitHub tokens are stored. Installation tokens are minted per task (read-only, scoped to the repo) and discarded. Uninstalling the App deletes our copy. |
| Webhook delivery IDs | Reject replayed deliveries | Postgres (`WebhookDelivery`) | IDs and event names only, no payloads |
| Updates: pushes to a connected repo's default branch (commit SHAs, messages, links, pusher login, linked PR titles) | Source for posts | Postgres (`Update`) | Marked `EXTERNAL_UNTRUSTED`. Commit author emails are dropped on intake and never stored. |
| Apps, imported store listings, brand profiles and voice | What posts are about and how they sound | Postgres (`App`, `StoreListing`, `BrandProfile`) | Imported listing text is marked `EXTERNAL_UNTRUSTED`; a profile becomes `USER` only when the user saves it. Images stay on the stores' own hosts. |
| OAuth tokens for Meta, Google, TikTok (_planned_) | Publish posts | Postgres | App-level envelope encryption (below), on top of at-rest encryption |
| GitHub App private key, client secret, webhook secret | Act as the App, verify webhooks | Host secret manager / local `.env` | Never in the database or code |
| Generated images and videos (_planned_) | Posts | Private S3-compatible bucket | Encrypted at rest; shared only by short-lived signed URLs |

We collect only what the product needs. A user can disconnect any account (we revoke the token where the platform allows and delete our copy) and delete their whole workspace.

## How it is encrypted

- **In transit:** HTTPS only (TLS 1.2+) with HSTS (`max-age` two years, `includeSubDomains`). When deployed, plain-HTTP page requests are redirected and any other plain-HTTP request, including webhooks, is refused.
- **At rest:** the managed Postgres database, its backups and the storage bucket use the provider's encryption at rest. This is confirmed per environment before it holds user data.
- **Sensitive fields:** tokens and credentials are also encrypted by the app before storage (`app/src/lib/crypto`):
  - every value gets its own random 256-bit data key and is encrypted with AES-256-GCM and a fresh random 96-bit nonce;
  - the data key is wrapped with a master key (also AES-256-GCM), and only the wrapped key is stored with the value;
  - each value records its master key version, so keys rotate by re-wrapping data keys; the value's own ciphertext is unchanged;
  - a value can be bound to its record (for example `account:<id>:accessToken`), so a ciphertext copied to another row will not decrypt;
  - any change to a stored value makes decryption fail.
- **Master keys** live only in the host's secret manager (`ENCRYPTION_MASTER_KEYS`) and in each developer's git-ignored `.env`. They are never stored in the database, logs or git.

## Permissions we request, and why

- **GitHub sign-in (OAuth App): no scopes.** Sign-in needs only the public profile, which GitHub returns without any scope. We do not ask for email or repository access at sign-in.
- **GitHub App, repository permissions, all read-only:** Metadata (required by GitHub; lists the installed repos), Contents (read commits behind a push), Pull requests (find the PR a push came from). No write access and no account permissions. Events: Push. Users choose which repositories it can see.
- **GitHub App user authorization during installation:** used once, to confirm the signed-in user can access the installation before we link it to their workspace. The resulting user token is revoked immediately and never stored.
- **Store listings:** only public App Store / Google Play data. We fetch fixed store endpoints built from the app ID, never the pasted URL, with no redirects, a timeout and a size cap.

## Environments

- **Staging (Render, `render.yaml`):** HTTPS-only on Render with HTTP redirected; managed Postgres with no public access. _To confirm in the Render dashboard when staging is created:_ HTTPS-only and encryption at rest for the database.

## Who can access it

- **The app** reads data scoped to the signed-in user's workspace. Every query that reads user data is scoped this way, with tests proving one user cannot read another's workspace by ID or by URL.
- **Sign-in** is limited to an allowlist of numeric GitHub user IDs while Jaded is in testing. Denied attempts are audit-logged. Sign-in routes are rate-limited (30 requests per minute per address, in memory per instance).
- **The owner** has access to hosting, the database and the secret manager. Access to those accounts requires two-factor sign-in.
- **Staff** (premium tier, later) will need a staff role and two-factor sign-in, and every staff view or change of user data is audit-logged. Staff never keep account passwords after handover.
- **Third parties:** the platforms a user connects receive only the posts the user approves. The AI provider receives post source material as quoted data; it has no tools and cannot post.

## Engineering safeguards

- Secrets are never committed. gitleaks runs as a pre-commit hook and in CI over the full history; a finding fails the build. `app/.env.example` holds only fake values.
- The app refuses to start if a required environment variable is missing or invalid (`app/src/lib/env.ts`).
- Logs are structured JSON and pass through a redaction helper that removes tokens, cookies, auth headers, webhook signatures, URL credentials and request bodies (`app/src/lib/log`).
- Pages get a strict nonce-based Content-Security-Policy (no `unsafe-inline`; `unsafe-eval` in development only) and standard security headers; API responses get `default-src 'none'`.
- CI runs type-checking, lint, tests, `npm audit --audit-level=high`, gitleaks and CodeQL on every push. Dependabot keeps dependencies current, and the lockfile is committed.
- Incoming GitHub webhooks: bodies over 1 MB are refused, the HMAC-SHA256 signature is checked in constant time before the body is parsed, a replayed delivery ID is ignored, and GitHub gets a quick 202 while a background job does the work. In production, plain-HTTP webhook requests are refused.
- API routes are rate-limited per client address (sign-in 30/min, webhooks 300/min, other API 120/min; in memory, per instance).
