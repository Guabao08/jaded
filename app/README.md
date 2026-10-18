# Jaded app

The Jaded site and dashboard: Next.js (App Router) + TypeScript, Prisma on PostgreSQL, and pg-boss for background jobs. The build plan is in [`../PLAN.md`](../PLAN.md); security details are in [`../SECURITY.md`](../SECURITY.md).

## Run locally

Requires Node.js 20.12 or later.

```sh
cd app
npm install                 # also generates the Prisma client and enables the gitleaks pre-commit hook
cp .env.example .env
npm run keygen              # paste the output into ENCRYPTION_MASTER_KEYS as v1:<key>
npm run dev                 # http://localhost:3000
```

The app validates its environment when it starts (`dev`, `build` and `start`) and exits with a list of the missing or invalid variable names if anything is wrong.

### Database

Phase 0 has no models and opens no database connection, so the app starts without Postgres. From Phase 1 on, point `DATABASE_URL` at a Postgres 15+ server (a local install, Docker, or `npx prisma dev` for a throwaway local one) and run `npm run db:migrate`.

## Checks

| Command                | What it does                              |
| ---------------------- | ----------------------------------------- |
| `npm run typecheck`    | TypeScript, no emit                       |
| `npm run lint`         | ESLint                                    |
| `npm run format:check` | Prettier (`npm run format` to fix)        |
| `npm test`             | Vitest unit tests                         |
| `npm run test:e2e`     | Playwright against a production build     |
| `npm audit`            | CI fails on any high or critical advisory |

`npm run test:e2e` needs `npm run build` first. It uses Playwright's Chromium (`npx playwright install chromium`); to use an installed browser instead, set `PW_CHANNEL=msedge` or `PW_CHANNEL=chrome`.

CI (`.github/workflows/`) runs all of the above, plus a gitleaks scan of the full history and CodeQL, on every push.

## Layout

- `src/lib/env.ts`: startup environment validation (zod).
- `src/lib/crypto/`: envelope encryption for sensitive fields (AES-256-GCM, per-value data keys, versioned master keys, rotation).
- `src/lib/log/`: structured JSON logger with mandatory redaction.
- `src/lib/security-headers.ts` and `src/proxy.ts`: security headers, nonce-based CSP, HTTPS enforcement.
- `src/lib/db.ts`, `src/lib/jobs.ts`: lazily created Prisma client and pg-boss queue.
- `prisma/`: schema and migrations. The generated client goes to `src/generated/` (git-ignored).
- `tests/unit/`, `e2e/`: Vitest and Playwright tests.

Next.js 16 calls middleware "proxy", so the request middleware lives in `src/proxy.ts`.
