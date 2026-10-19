import { expect, test } from "@playwright/test";

test("home page loads under the strict CSP with security headers", async ({ page }) => {
  const cspViolations: string[] = [];
  page.on("console", (msg) => {
    if (/Content Security Policy|Refused to/i.test(msg.text())) cspViolations.push(msg.text());
  });
  page.on("pageerror", (error) => cspViolations.push(error.message));

  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const headers = response!.headers();
  expect(headers["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(headers["strict-transport-security"]).toContain("max-age=63072000");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-powered-by"]).toBeUndefined();

  // Every script Next.js rendered carries the nonce, so nothing was blocked.
  const unnoncedScripts = await page.locator("script:not([nonce])").count();
  expect(unnoncedScripts).toBe(0);
  expect(cspViolations).toEqual([]);
});

test("API responses get the locked-down CSP", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
  expect(response.headers()["content-security-policy"]).toContain("default-src 'none'");
});
