# Security

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's **Report a vulnerability** button on this repository's Security tab (private vulnerability reporting). Do not open a public issue. Include what you found, how to reproduce it, and what it affects. We aim to reply within 3 working days and will tell you when it is fixed. Please give us a reasonable time to fix an issue before disclosing it.

Jaded is pre-launch and only its owner uses it, so there is no bug bounty yet.

## What we store

This section grows as features are built. Items marked _planned_ are not stored yet.

| Data | Why | Where | Protection |
| --- | --- | --- | --- |
| Account email and name (_planned, Phase 1_) | Sign-in | Postgres | Encrypted at rest by the database provider |
| Sign-in sessions (_planned, Phase 1_) | Keep users signed in | Postgres, browser cookie | `httpOnly`, `Secure`, `SameSite=Lax` cookie; rotated on login; expire |
| OAuth access and refresh tokens for GitHub, Meta, Google, TikTok (_planned_) | Read repos, publish posts | Postgres | App-level envelope encryption (below), on top of at-rest encryption |
| GitHub App credentials, webhook secrets (_planned_) | Receive pushes | Host secret manager | Never in the database or code |
| Commit messages, PR text, app store listings (_planned_) | Source for posts | Postgres | Treated as untrusted input; sent to the AI only as quoted data |
| Generated images and videos (_planned_) | Posts | Private S3-compatible bucket | Encrypted at rest; shared only by short-lived signed URLs |
| Audit log (_planned_) | Record sign-ins, connections, publishes, staff actions | Postgres | Append-only from the app |

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

## Who can access it

- **The app** reads data scoped to the signed-in user's workspace. Every query that reads user data is scoped this way, with tests proving one user cannot read another's data (from Phase 1).
- **The owner** has access to hosting, the database and the secret manager. Access to those accounts requires two-factor sign-in.
- **Staff** (premium tier, later) will need a staff role and two-factor sign-in, and every staff view or change of user data is audit-logged. Staff never keep account passwords after handover.
- **Third parties:** the platforms a user connects receive only the posts the user approves. The AI provider receives post source material as quoted data; it has no tools and cannot post.

## Engineering safeguards

- Secrets are never committed. gitleaks runs as a pre-commit hook and in CI over the full history; a finding fails the build. `app/.env.example` holds only fake values.
- The app refuses to start if a required environment variable is missing or invalid (`app/src/lib/env.ts`).
- Logs are structured JSON and pass through a redaction helper that removes tokens, cookies, auth headers, webhook signatures, URL credentials and request bodies (`app/src/lib/log`).
- Pages get a strict nonce-based Content-Security-Policy (no `unsafe-inline`; `unsafe-eval` in development only) and standard security headers; API responses get `default-src 'none'`.
- CI runs type-checking, lint, tests, `npm audit --audit-level=high`, gitleaks and CodeQL on every push. Dependabot keeps dependencies current, and the lockfile is committed.
- Incoming webhooks are verified with a constant-time signature check before parsing, and replays are rejected by delivery ID (from Phase 2).
