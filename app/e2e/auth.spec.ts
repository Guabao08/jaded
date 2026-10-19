import { createHash } from "node:crypto";
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import pg from "pg";

const MOCK_GITHUB = "http://127.0.0.1:3101";
const SESSION_COOKIE = "__Secure-jaded.session";

const alice = { id: 1001, login: "alice", name: "Alice" };
const bob = { id: 1002, login: "bob", name: "Bob" };
const mallory = { id: 2001, login: "mallory", name: "Mallory" }; // not on the allowlist

const sql = new pg.Pool({ connectionString: process.env.DATABASE_URL });
test.afterAll(() => sql.end());

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

async function nextGitHubUser(request: APIRequestContext, user: typeof alice) {
  await request.post(`${MOCK_GITHUB}/__next-user`, { data: user });
}

async function signInAs(page: Page, user: typeof alice) {
  await nextGitHubUser(page.request, user);
  await page.goto("/signin");
  await page.getByRole("button", { name: "Continue with GitHub" }).click();
}

async function sessionCookie(context: BrowserContext) {
  return (await context.cookies()).find((c) => c.name === SESSION_COOKIE);
}

async function userId(githubId: number): Promise<string> {
  const { rows } = await sql.query('SELECT id FROM "User" WHERE "githubId" = $1', [String(githubId)]);
  return rows[0].id;
}

async function auditActions(actorUserId: string | null, action: string): Promise<number> {
  const { rows } = await sql.query(
    'SELECT count(*)::int AS n FROM "AuditLog" WHERE action = $1 AND ("actorUserId" = $2 OR $2 IS NULL)',
    [action, actorUserId],
  );
  return rows[0].n;
}

test("private pages send signed-out visitors to sign-in", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/signin$/);
  await page.goto("/w/some-workspace");
  await expect(page).toHaveURL(/\/signin$/);
});

test("an allowlisted user signs in to their workspace with a secure session cookie", async ({ page, context }) => {
  await signInAs(page, alice);
  await expect(page).toHaveURL(/\/w\/[a-z0-9]+$/);
  await expect(page.getByRole("heading", { name: "alice's workspace" })).toBeVisible();

  const cookie = await sessionCookie(context);
  expect(cookie).toBeDefined();
  expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });
  const days = (cookie!.expires * 1000 - Date.now()) / 86_400_000;
  expect(days).toBeGreaterThan(6.9);
  expect(days).toBeLessThanOrEqual(7);

  // The database holds only a hash of the cookie's token.
  const { rows } = await sql.query('SELECT "sessionTokenHash" FROM "Session" WHERE "sessionTokenHash" = $1', [
    hash(cookie!.value),
  ]);
  expect(rows).toHaveLength(1);

  expect(await auditActions(await userId(alice.id), "auth.sign_in")).toBeGreaterThanOrEqual(1);
});

test("signing in again rotates the session ID", async ({ page, context }) => {
  await signInAs(page, alice);
  await expect(page).toHaveURL(/\/w\//);
  const before = (await sessionCookie(context))!.value;

  // Start a second sign-in from the same browser while still signed in.
  await nextGitHubUser(page.request, alice);
  const { csrfToken } = await (await page.request.get("/api/auth/csrf")).json();
  await page.request.post("/api/auth/signin/github", { form: { csrfToken, callbackUrl: "/dashboard" } });

  const after = (await sessionCookie(context))!.value;
  expect(after).not.toBe(before);
  const old = await sql.query('SELECT 1 FROM "Session" WHERE "sessionTokenHash" = $1', [hash(before)]);
  expect(old.rows).toHaveLength(0);
  expect(await auditActions(await userId(alice.id), "auth.session_revoked_on_login")).toBeGreaterThanOrEqual(1);

  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "alice's workspace" })).toBeVisible();
});

test("user A cannot load user B's workspace by URL", async ({ browser }) => {
  const bobContext = await browser.newContext();
  const bobPage = await bobContext.newPage();
  await signInAs(bobPage, bob);
  await expect(bobPage).toHaveURL(/\/w\//);
  const bobWorkspaceUrl = new URL(bobPage.url()).pathname;
  await bobContext.close();

  const aliceContext = await browser.newContext();
  const alicePage = await aliceContext.newPage();
  await signInAs(alicePage, alice);
  await expect(alicePage).toHaveURL(/\/w\//);

  const response = await alicePage.goto(bobWorkspaceUrl);
  expect(response?.status()).toBe(404);
  await expect(alicePage.getByText("bob's workspace")).toHaveCount(0);
  await aliceContext.close();
});

test("someone not on the allowlist cannot sign in", async ({ page, context }) => {
  await signInAs(page, mallory);
  await expect(page).toHaveURL(/\/signin\?error=AccessDenied/);
  // Next.js also renders a route announcer with role="alert", so match the notice itself.
  await expect(page.locator("p.notice[role=alert]")).toContainText("not on the testing allowlist");
  expect(await sessionCookie(context)).toBeUndefined();

  const users = await sql.query('SELECT 1 FROM "User" WHERE "githubId" = $1', [String(mallory.id)]);
  expect(users.rows).toHaveLength(0);
  const denied = await sql.query(
    `SELECT 1 FROM "AuditLog" WHERE action = 'auth.sign_in_denied' AND metadata->>'githubId' = $1`,
    [String(mallory.id)],
  );
  expect(denied.rows.length).toBeGreaterThanOrEqual(1);

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/signin$/);
});

test("signing out ends the session", async ({ page, context }) => {
  await signInAs(page, alice);
  await expect(page).toHaveURL(/\/w\//);
  const token = (await sessionCookie(context))!.value;
  const signOutsBefore = await auditActions(await userId(alice.id), "auth.sign_out");

  await page.getByRole("button", { name: "Sign out" }).first().click();
  await expect(page).toHaveURL(/\/$/);
  expect(await sessionCookie(context)).toBeUndefined();
  const rows = await sql.query('SELECT 1 FROM "Session" WHERE "sessionTokenHash" = $1', [hash(token)]);
  expect(rows.rows).toHaveLength(0);
  expect(await auditActions(await userId(alice.id), "auth.sign_out")).toBe(signOutsBefore + 1);

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/signin$/);
});
