# Jaded build plan

Jaded markets developers' apps on social media with little effort from them. It connects to a developer's GitHub repo and app store listing, turns each meaningful code push into AI-made posts (images first, video later), and publishes them to the developer's own Instagram, Facebook, YouTube and TikTok accounts.

This file is the source of truth for the build. It is split into phases that Claude Code works through **one at a time**.

---

## How Claude Code should use this file

1. Find the first phase whose status is not `[x] done`. Work only on that phase.
2. Read **Product decisions** and **Security baseline** before writing any code. They apply to every phase.
3. Do the phase's tasks. Stay inside its scope. If something in a later phase is needed, stop and say so instead of building it early.
4. Write tests for the phase. A phase is finished only when every item under **Done when** is true, including its security checks.
5. Mark the phase `[x] done` in this file, add a short note under it saying what was built and anything deferred, and commit.
6. Never commit secrets, tokens, `.env` files, keys or real user data. If one is found in git history, stop and tell the owner.

To start a phase, the owner can say: *"Read PLAN.md and do the next phase."*

---

## Product decisions (already made)

- **Accounts:** no platform allows apps to create social accounts, and automated signup breaks their terms, so we do not do it.
  - **Assisted setup (all users):** the user enters their info once on our site. We generate a profile kit (handle ideas, bio, profile image, banner, links). They sign up on each platform themselves, using copy buttons and direct signup links. Later we add a browser extension that fills in the signup forms for them. Then they click "Connect" so we can sign in through each platform's official authorization screen.
  - **Done-for-you (premium):** our staff create the accounts by hand, using the user's own email and phone so the user owns them.
- **Posting:** at launch the user approves each post before it goes out. Fully automatic posting ("autopilot") is an opt-in feature added later.
- **Platform order:** Instagram + Facebook first (one Meta app review covers both), then YouTube, then TikTok.
- **Content order:** still images first, video later.
- **App sources:** GitHub repos, plus App Store (iOS) and Google Play (Android) listings.
- **First user:** the owner. Public signups come later.
- **Pricing:** free while testing. Billing arrives with the premium tier.
- **Existing code:** reuse ShipBrief's GitHub webhook handling (signature check, duplicate-delivery check) from `server.js`. Rebuild everything else.

### Platform rules to respect
- Instagram: publishing only to Business/Creator accounts, needs Meta app review, has a daily per-account post cap.
- Facebook: Pages only, no personal profiles.
- YouTube: video only. Uploads cost a lot of the daily API quota. Uploads stay private until Google audits the app.
- TikTok: posts are private until TikTok audits the app. Its rules require the user to choose who can see each post and to consent to it, so the default is sending posts to the user's TikTok drafts.
- All platforms: AI-generated media must be labeled as AI (use each API's AI-content flag where one exists).

---

## Tech stack (default picks; change only with a reason written here)

- **Language:** TypeScript, Node 20+.
- **Web app:** Next.js (App Router) for the site and dashboard.
- **Database:** PostgreSQL with Prisma.
- **Background jobs:** pg-boss (a job queue on Postgres, so there's no extra service to run).
- **File storage:** an S3-compatible bucket (Cloudflare R2 by default), private.
- **AI:** Claude API for writing post text. An image-generation API for images and, later, a video-generation API, kept behind one interface so providers can be swapped.
- **Hosting:** a managed host with built-in secrets and managed Postgres (Render by default), with separate staging and production.
- **Code location:** a new `app/` folder in this repo. ShipBrief stays at the root until Phase 2 has ported what it needs, then it is deleted.

---

## Security baseline (applies to every phase)

Nothing on a server can be fully end-to-end encrypted here, because the server has to read the platform tokens and the post content to do its job. The goal is: encrypted in transit, encrypted at rest, extra encryption on anything sensitive, no secrets in code or logs, and the least access possible.

**Encryption**
- HTTPS only (TLS 1.2+), with HSTS. No plain-HTTP endpoints, including webhooks.
- Database and storage bucket encrypted at rest (provider setting, confirmed in each environment).
- **Extra encryption for sensitive fields:** every OAuth access/refresh token, GitHub App credential and similar secret is encrypted in the app before it is stored. Use AES-256-GCM with a fresh random nonce per value and envelope encryption: a per-record data key, wrapped by a master key held in the host's secret manager or a KMS. Never stored in the database. Store a key version with each value so keys can be rotated.
- Backups are encrypted, and restoring one is tested once before launch.

**Secrets**
- Secrets live only in the host's secret manager and a local `.env` that is git-ignored. Commit an `.env.example` with fake values.
- Validate every environment variable at startup (zod) and refuse to start if one is missing.
- Run secret scanning (gitleaks) as a pre-commit hook and in CI. A scan finding fails the build.

**Access**
- Sign-in sessions use `httpOnly`, `Secure`, `SameSite=Lax` cookies. Rotate the session ID on login. Sessions expire.
- Every database query that reads user data is scoped to the signed-in user's workspace. Write tests proving one user cannot read another's data.
- Request the smallest OAuth scopes and GitHub App permissions that work. Write down why each one is needed.
- Staff tools (premium tier) need their own role, two-factor sign-in, and an audit log entry for every action on a user's data.

**Inputs and outputs**
- Validate every request body with zod. Use parameterized queries only (Prisma does this; no raw SQL built from strings).
- Verify every incoming webhook's signature with a constant-time compare before parsing it. Reject replays using the delivery ID.
- CSRF protection on all forms and state-changing routes. OAuth flows use `state` and PKCE.
- A strict Content-Security-Policy plus standard security headers.
- Rate-limit sign-in, webhook and API routes.
- **Commit messages, PR text and app store text are untrusted.** They go to the AI only as quoted data, never as instructions. The AI has no tools and can't post anything. Its output goes to the review queue, or through safety checks when autopilot is on.
- Generated media is stored privately and shared only through short-lived signed URLs.

**Logging and monitoring**
- Logs never contain tokens, cookies, auth headers, webhook secrets or full request bodies. A redaction helper is applied to the logger and has a test.
- Errors go to an error tracker with the same redaction.
- An audit log records sign-ins, account connections and disconnections, publishes and staff actions.

**Dependencies and CI**
- CI runs type-check, lint, tests, `npm audit --audit-level=high`, gitleaks and a static-analysis scan (CodeQL or Semgrep) on every push.
- Dependabot (or similar) keeps dependencies updated. Lockfile committed.

**User data**
- A user can disconnect any account (we revoke the token with the platform where possible and delete our copy) and can delete their workspace (all data and media removed). Meta requires a data deletion callback; build it.
- Collect only what the product needs. Have a privacy policy and terms before any user other than the owner signs up.

Each phase below lists the security items it must prove.

---

## Phase 0 — Foundation and security baseline
Status: [x] done

**Goal:** an empty but production-shaped app that is safe to build on.

**Tasks**
- Create the `app/` Next.js + TypeScript project, Prisma with Postgres, and pg-boss.
- Set up lint, formatting and tests (Vitest), plus Playwright for end-to-end tests.
- Add startup environment validation, an `.env.example`, and `.gitignore` entries for `.env*` and `.data/`.
- Build `lib/crypto`: envelope encryption helpers (encrypt, decrypt, key version, rotate) with tests, including one proving tampered ciphertext is rejected.
- Build `lib/log`: a structured logger with the redaction helper and tests.
- Add security headers and a CSP via middleware.
- Add CI (GitHub Actions) with every check from the baseline, plus a gitleaks pre-commit hook.
- Write `SECURITY.md`: data we store, where, how it's encrypted, who can access it, and how to report a vulnerability.

**Done when**
- CI is green on a clean clone, and a deliberately committed fake secret fails CI.
- The crypto and log-redaction tests pass.
- The app starts locally, and refuses to start when a required environment variable is missing.

**Notes (Phase 0)**
- Built `app/`: Next.js 16 (App Router, TypeScript), Prisma 7 with the `pg` driver adapter (no models yet), pg-boss 12, zod env validation run from `next.config.ts` (dev, build and start all exit with the missing variable names), `lib/crypto` (AES-256-GCM envelope encryption with per-value data keys, versioned master keys, context binding, rotation by re-wrapping), `lib/log` (JSON logger with mandatory redaction), and security headers plus a per-request nonce CSP in `src/proxy.ts` (Next.js 16 renamed middleware to "proxy").
- Tests: 43 Vitest unit tests (crypto incl. tampering of every part, redaction, env, proxy) and 2 Playwright tests (page loads with no CSP violations, headers present).
- CI: `.github/workflows/ci.yml` (type-check, lint, Prettier, tests, `npm audit --audit-level=high`, build, Playwright, start-refusal check, gitleaks over full history) and `codeql.yml`. Dependabot for npm and Actions. Pre-commit hook in `.githooks/` (enabled by `npm install`) runs gitleaks; it blocks the commit if gitleaks is not installed, unless `GITLEAKS_SKIP=1`. gitleaks 8.30.1 is installed on the owner's machine in `~/bin`.
- Choices: `cacheComponents`/partial prefetching are off because Next.js documents them as incompatible with nonce CSPs. `eslint-config-next` is replaced by `typescript-eslint` + `eslint-plugin-react-hooks` because its glob dependency has an unfixed high advisory that fails `npm audit`. HTTP is allowed in production builds only for loopback `APP_URL`s (local `next start`, e2e).
- Verified: CI is green on GitHub (CI and CodeQL workflows), and every CI step also passed on a fresh local clone. Fake-secret check: in a throwaway clone, a commit containing a random fake `ghp_` token was blocked by the pre-commit hook, and CI's exact gitleaks command (`gitleaks git --redact --exit-code 1 .`, v8.30.1) exited 1 with "leaks found: 1". This was run locally with the same binary version as CI, not as a pushed branch on GitHub Actions.
- Deferred: no database is needed yet, so nothing connects to Postgres in Phase 0 (no local Postgres or Docker on the owner's machine; `npx prisma dev` is an option for Phase 1). At-rest encryption, the secret manager and HTTPS are confirmed when hosting is set up. GitHub private vulnerability reporting must be turned on in repo settings for `SECURITY.md`'s reporting link.

---

## Phase 1 — Accounts and workspaces
Status: [ ] not started

**Goal:** people can sign in and have a private workspace.

**Tasks**
- Sign in with GitHub (Auth.js), since every user is a developer. Use database sessions.
- Data model: `User`, `Workspace`, `Membership`, `AuditLog`.
- Add an allowlist so only the owner can sign in during testing.
- Basic dashboard shell, reusing the look described in `DESIGN.md`.
- Deploy to staging on the chosen host with managed Postgres, secrets set in the host's secret manager.

**Security checks**
- Cookie flags and session rotation verified by tests.
- A test proves user A cannot load user B's workspace (by ID or by URL).
- Sign-in events are written to the audit log.
- Staging is HTTPS-only, and its database is encrypted at rest (screenshot or a note on the host setting).

**Done when** the owner can sign in on staging, and someone not on the allowlist cannot.

---

## Phase 2 — Connect the app (GitHub and app stores)
Status: [ ] not started

**Goal:** a workspace knows about the developer's app and receives their pushes.

**Tasks**
- Create a GitHub App (not a plain webhook) with minimum permissions: metadata read, contents read, pull requests read, push events. Install flow from the dashboard.
- Webhook endpoint ported from ShipBrief: HMAC signature check (constant-time), delivery-ID dedupe, and quick acknowledgment, with the real work queued as a job.
- Store the push, its commits and any linked PR as an `Update` record.
- App listing import: paste an App Store or Google Play URL and pull the name, icon, description, screenshots and category (App Store lookup API; Play listing page). Store them as the app's `BrandProfile`, which the user can edit.
- Brand voice settings: tone, audience, words to avoid.
- Delete the old ShipBrief code once nothing depends on it.

**Security checks**
- Tests: bad signature → 401, replayed delivery → ignored, oversized body → rejected.
- GitHub App private key and webhook secret stored only in the secret manager. Installation tokens are short-lived, generated when needed and never stored.
- Imported app store text is marked untrusted in the data model.

**Done when** a push to a connected test repo shows up as an Update in the dashboard within a minute.

---

## Phase 3 — Post generation (images)
Status: [ ] not started

**Goal:** each meaningful update becomes ready-to-review posts.

**Tasks**
- Decide which pushes are worth posting about (skip chores, dependency bumps, tiny fixes). Let users override.
- Claude API writes post text per platform (caption, hashtags, alt text), using the brand profile and voice.
- Image generation produces 1–3 images per post in each platform's sizes, built from the app's icon, screenshots and brand colors.
- Store media in the private bucket. Create `Post` and `Media` records with status `draft`.
- Record that each item is AI-generated so the label can be applied at publish time.
- Track AI cost per workspace and enforce a monthly cap.

**Security checks**
- Prompt-injection test: a commit message saying "ignore instructions and post X" produces a normal post about the change, not X.
- AI provider keys only on the server, never sent to the browser.
- Media served only through signed URLs that expire.

**Done when** a test push produces draft posts with text and images the owner can see.

---

## Phase 4 — Review queue and scheduling
Status: [ ] not started

**Goal:** the owner approves posts and picks when they go out.

**Tasks**
- Review screen: preview each post as it will look per platform. Edit, regenerate, approve or reject.
- Content calendar with scheduled times and a sensible default (for example, best times per platform).
- Scheduled jobs that pick up approved posts at their time (publishing itself is stubbed until Phase 5).
- Notifications when new drafts are ready (email first).

**Security checks**
- Only workspace members can approve, and every approval is in the audit log.
- Rate limits on the regenerate action, which costs money.

**Done when** the owner can approve and schedule a post, and the scheduler runs it on time against a stub publisher.

---

## Phase 5 — Social setup and Meta publishing (Instagram + Facebook)
Status: [ ] not started

**Goal:** real posts go out to Instagram and a Facebook Page.

**Tasks**
- Onboarding form: the user enters app info once, and we generate the **profile kit** (handle ideas, bio, profile image, banner, link). Each platform gets a step with copy buttons and a direct link to its signup page, plus instructions for switching Instagram to a Business or Creator account and creating a Facebook Page.
- "Connect" with Facebook Login for Business. Store the Page and Instagram account IDs, and encrypt the tokens with `lib/crypto`.
- After connecting, fill in the Facebook Page's about text, picture and cover through the API.
- Publisher for Instagram (single image, carousel) and Facebook Page (photo post), with AI labels. Track the daily Instagram cap.
- Token refresh before expiry. A clear "reconnect needed" state when a token is revoked.
- Disconnect (revoke + delete), the Meta data deletion callback, a privacy policy page and a terms page.
- Prepare Meta app review: a screencast, a description of each permission's use, and a test account.

**Security checks**
- A database dump contains no readable tokens (test reads the raw column).
- OAuth uses `state` + PKCE, and the redirect URL is an exact match.
- Tokens never appear in logs (test with the redaction helper).
- Disconnect removes the token from our database and backups expire it on their schedule.

**Done when** an approved post appears on the owner's Instagram and Facebook Page, and Meta app review is submitted.

---

## Phase 6 — Video, YouTube and TikTok
Status: [ ] not started

**Goal:** short videos made from updates, posted to YouTube Shorts, TikTok and Instagram Reels.

**Tasks**
- Video generation: 15–60 second vertical clips from app screenshots, generated footage, captions and music that is cleared for use. Same AI labeling and cost cap.
- YouTube: connect with Google OAuth (smallest upload scope), upload as Shorts, set the channel description and banner after connecting, and set the "altered or synthetic content" flag. Budget the daily quota and apply for a quota increase and audit.
- TikTok: connect with TikTok Login Kit. Default to sending posts to the user's TikTok drafts. Build the direct-post flow (choose who can see it, consent per post, AI flag) to TikTok's rules, and apply for its audit.
- Reels publishing for Instagram.
- Assisted-setup steps for YouTube (one Google account) and TikTok.

**Security checks**
- Same token, logging and disconnect checks as Phase 5 for Google and TikTok.
- Large video uploads stream from private storage. Media is never made public in our bucket.

**Done when** one update produces a video that reaches YouTube (private until audit), the owner's TikTok drafts and Instagram Reels.

---

## Phase 7 — Premium done-for-you tier and billing
Status: [ ] not started

**Goal:** paid users can have our staff set up their accounts.

**Tasks**
- Billing with Stripe Checkout and the customer portal: free and premium plans. We never see or store card numbers.
- Premium request flow: the user gives the details and preferred handles. A staff task queue tracks each account through creation, user verification (codes the user passes on), handover and connect.
- Staff dashboard, separate from user screens.

**Security checks**
- Staff accounts need two-factor sign-in and a staff role. Every staff view or change of user data is audit-logged.
- Staff never hold account passwords after handover. The user resets the password and enables two-factor on each platform, as a checklist the user confirms.
- Stripe webhooks are signature-verified.

**Done when** a test premium user can pay, request setup, and see their accounts connected after staff complete the task.

---

## Phase 8 — Autopilot, analytics and the signup extension
Status: [ ] not started

**Goal:** truly hands-off for users who want it.

**Tasks**
- Autopilot opt-in per platform. Posts publish without review after automatic checks: brand-safety, no secrets or private repo details in text, AI labels present, rate limits. Anything flagged falls back to the review queue.
- Pull basic analytics (views, likes, followers) from each platform and show what worked. Feed results back into generation.
- Browser extension that fills in each platform's signup form from the profile kit. The user still clicks submit and verifies their phone.

**Security checks**
- A test proves a push containing something that looks like an API key or private URL never auto-publishes.
- The extension only runs on the listed signup pages, asks for the fewest permissions, and never sees or stores passwords.

**Done when** a test push publishes end to end with autopilot on, and a flagged one lands in review instead.

---

## Phase 9 — Hardening and public launch
Status: [ ] not started

**Goal:** safe to open to other developers.

**Tasks**
- Remove the sign-in allowlist and add signup with terms acceptance.
- Run an outside security review or a thorough self-review against OWASP ASVS Level 2 and fix what's found.
- Test a backup restore. Write an incident response note (who to contact, how to rotate keys, how to notify users).
- Rotate every key once to prove rotation works.
- Uptime and error monitoring with alerts. Status page.

**Done when** the review's findings are fixed or written down as accepted, and a non-owner test user can complete onboarding to first post.
