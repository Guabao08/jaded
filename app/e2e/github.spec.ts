import { createHmac } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

const MOCK_GITHUB = "http://127.0.0.1:3101";
const secret = process.env.E2E_WEBHOOK_SECRET ?? "";
const alice = { id: 1001, login: "alice", name: "Alice" };
const bob = { id: 1002, login: "bob", name: "Bob" };

const sql = new pg.Pool({ connectionString: process.env.DATABASE_URL });
test.afterAll(() => sql.end());
test.describe.configure({ mode: "serial" });

async function signInAs(page: Page, user: typeof alice) {
  await page.request.post(`${MOCK_GITHUB}/__next-user`, { data: user });
  await page.goto("/signin");
  await page.getByRole("button", { name: "Continue with GitHub" }).click();
  await expect(page).toHaveURL(/\/w\/[a-z0-9]+$/);
  return new URL(page.url()).pathname;
}

function push(sha: string, message: string, ref = "refs/heads/main") {
  return JSON.stringify({
    ref,
    before: "0".repeat(40),
    after: sha,
    compare: "https://github.com/alice/demo/compare/000...abc",
    commits: [
      {
        id: sha,
        message,
        timestamp: new Date().toISOString(),
        author: { email: "alice@example.com", username: "alice" },
      },
    ],
    head_commit: { id: sha, timestamp: new Date().toISOString() },
    repository: { id: 777, full_name: "alice/demo", html_url: "https://github.com/alice/demo", default_branch: "main" },
    sender: { login: "alice" },
    installation: { id: 5001 },
  });
}

function sign(body: string) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

async function sendPush(page: Page, deliveryId: string, sha: string, message: string) {
  const body = push(sha, message);
  const res = await page.request.post("/api/github/webhook", {
    data: body,
    headers: {
      "content-type": "application/json",
      "x-github-event": "push",
      "x-github-delivery": deliveryId,
      "x-hub-signature-256": sign(body),
    },
  });
  expect(res.status()).toBe(202);
}

async function waitFor(page: Page, url: string, text: string | RegExp) {
  await expect(async () => {
    await page.goto(url);
    await expect(page.getByText(text).first()).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 60_000 });
}

test("the owner connects GitHub, and a push shows up as an Update within a minute", async ({ page }) => {
  const workspace = await signInAs(page, alice);
  await page.getByRole("button", { name: "Connect GitHub" }).click();
  await expect(page.getByRole("status")).toHaveText("GitHub is connected.");
  await expect(page.getByText("Connected to alice with read-only access to 1 repository.")).toBeVisible();

  const body = push("abc1234".padEnd(40, "0"), "Ship offline mode\n\nWorks on the subway now.");
  const headers = { "content-type": "application/json", "x-github-event": "push", "x-github-delivery": "e2e-push-1" };
  const accepted = await page.request.post("/api/github/webhook", {
    data: body,
    headers: { ...headers, "x-hub-signature-256": sign(body) },
  });
  expect(accepted.status()).toBe(202);

  const started = Date.now();
  await page.goto(`${workspace}/updates`);
  await expect(async () => {
    await page.reload();
    await expect(page.getByText("Ship offline mode").first()).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 60_000 });
  expect(Date.now() - started).toBeLessThan(60_000);
  await expect(page.getByRole("link", { name: "#12 Dark mode" })).toBeVisible();
  await expect(page.getByText("alice@example.com")).toHaveCount(0);

  // A replay of the same delivery is ignored, and a bad signature is refused.
  const replay = await page.request.post("/api/github/webhook", {
    data: body,
    headers: { ...headers, "x-hub-signature-256": sign(body) },
  });
  expect(replay.status()).toBe(200);
  const forged = await page.request.post("/api/github/webhook", {
    data: body,
    headers: { ...headers, "x-github-delivery": "e2e-push-2", "x-hub-signature-256": sign(body + " ") },
  });
  expect(forged.status()).toBe(401);
  const { rows } = await sql.query('SELECT count(*)::int AS n FROM "Update"');
  expect(rows[0].n).toBe(1);
});

test("the owner adds an app, links the repository and sets the brand voice", async ({ page }) => {
  const workspace = await signInAs(page, alice);
  await page.getByLabel("New app name").fill("Demo");
  await page.getByRole("button", { name: "Add app" }).click();
  await expect(page.getByRole("heading", { name: "Demo", level: 1 })).toBeVisible();

  await page.getByLabel("Repository").selectOption({ label: "alice/demo" });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Repository saved.");

  await page.getByLabel("Tone").fill("friendly, plain-spoken");
  await page.getByLabel("Audience").fill("indie developers");
  await page.getByLabel(/Words to avoid/).fill("revolutionary, game-changer");
  await page.getByRole("button", { name: "Save brand voice" }).click();
  await expect(page.getByRole("status")).toHaveText("Brand voice saved.");
  await expect(page.getByLabel(/Words to avoid/)).toHaveValue("revolutionary, game-changer");

  // Only store links are accepted for import; anything else is refused before any fetch.
  await page.getByLabel("Listing link").fill("https://evil.example/app");
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.locator("p.notice[role=alert]")).toContainText("Only App Store");

  await page.goto(workspace);
  await expect(page.getByRole("link", { name: "Demo" })).toBeVisible();
});

test("a feature push becomes AI-labelled draft posts with images, served only through signed links", async ({
  page,
}) => {
  const workspace = await signInAs(page, alice);
  await sendPush(page, "e2e-push-feature", "f00d".padEnd(40, "1"), "feat: dark mode\n\nEasier on the eyes at night.");
  await waitFor(page, `${workspace}/updates`, /Drafts ready/);
  await expect(page.getByText("Worth a post").first()).toBeVisible();

  await page.getByRole("link", { name: "View 2 drafts" }).click();
  await expect(page.getByRole("heading", { name: "Draft posts" })).toBeVisible();
  const instagram = page.locator("section.post", { hasText: "Instagram" }).first();
  await expect(instagram.getByText("AI-generated")).toBeVisible();
  await expect(instagram.getByRole("heading", { name: "Dark mode" })).toBeVisible();
  await expect(page.getByText(/AI use this month/)).toBeVisible();

  // Every image loads from a signed link.
  const images = page.locator("section.post img");
  await expect(images).toHaveCount(4);
  for (const img of await images.all()) {
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0);
  }
  const src = (await images.first().getAttribute("src"))!;
  expect(src).toMatch(/^\/api\/media\/[a-z0-9]+\?exp=\d+&sig=[A-Za-z0-9_-]{43}$/);
  const okRes = await page.request.get(src);
  expect(okRes.status()).toBe(200);
  expect(okRes.headers()["content-type"]).toBe("image/png");

  // Without a valid signature, nothing is served.
  const unsigned = src.split("?")[0];
  expect((await page.request.get(unsigned)).status()).toBe(403);
  expect((await page.request.get(src.replace(/sig=[^&]+/, "sig=" + "A".repeat(43)))).status()).toBe(403);
  expect((await page.request.get(src.replace(/exp=\d+/, "exp=1000"))).status()).toBe(403);
});

test("a chore push is skipped, and the owner can choose to post about it anyway", async ({ page }) => {
  const workspace = await signInAs(page, alice);
  await sendPush(page, "e2e-push-chore", "c40e".padEnd(40, "2"), "chore: update dependencies");
  await waitFor(page, `${workspace}/updates`, /Only maintenance commits/);
  const chore = page.locator("li.update", { hasText: "chore: update dependencies" });
  await expect(chore.getByText("Skipped")).toBeVisible();
  await chore.getByRole("button", { name: "Post about this anyway" }).click();
  await waitFor(page, `${workspace}/updates`, /You chose to post about this update/);
  await expect(async () => {
    await page.reload();
    await expect(
      page.locator("li.update", { hasText: "chore: update dependencies" }).getByText("Drafts ready"),
    ).toBeVisible({
      timeout: 1000,
    });
  }).toPass({ timeout: 60_000 });
});

test("another user cannot see the owner's app, repository or updates", async ({ page }) => {
  const { rows } = await sql.query('SELECT id, "workspaceId" FROM "App" LIMIT 1');
  const app = rows[0];

  const bobWorkspace = await signInAs(page, bob);
  await expect(page.getByText("alice/demo")).toHaveCount(0);
  const appPage = await page.goto(`/w/${app.workspaceId}/apps/${app.id}`);
  expect(appPage?.status()).toBe(404);
  const updates = await page.goto(`/w/${app.workspaceId}/updates`);
  expect(updates?.status()).toBe(404);
  const posts = await page.goto(`/w/${app.workspaceId}/posts`);
  expect(posts?.status()).toBe(404);
  await page.goto(`${bobWorkspace}/updates`);
  await expect(page.getByText("Ship offline mode")).toHaveCount(0);
});

test("a forged install callback without our state is refused", async ({ page }) => {
  await signInAs(page, bob);
  await page.goto("/api/github/callback?installation_id=5001&code=appcode-1002-1&state=guessed");
  await expect(page).toHaveURL(/github=state/);
  const { rows } = await sql.query('SELECT "workspaceId" FROM "GitHubInstallation"');
  expect(rows).toHaveLength(1);
});
