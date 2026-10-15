import { expect, test } from "@playwright/test";

/**
 * Phase 0 acceptance: owner login works, bad credentials are refused, and
 * every non-public route is gated. Credentials come from the environment so no
 * password is committed:
 *
 *   E2E_OWNER_EMAIL=… E2E_OWNER_PASSWORD=… npm run e2e
 */
const email = process.env.E2E_OWNER_EMAIL;
const password = process.env.E2E_OWNER_PASSWORD;

test.describe("owner auth", () => {
  test("unauthenticated root redirects to the login page", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Flight Deck" })).toBeVisible();
  });

  test("protected API returns 401 without a session", async ({ request }) => {
    const res = await request.get("/api/auth/session");
    expect(res.status()).toBe(401);
  });

  test("health endpoint is public and reports the database", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.ok()).toBe(true);
    expect(await res.json()).toMatchObject({ ok: true, db: "up" });
  });

  test("wrong password is refused without revealing the account", async ({ page }) => {
    test.skip(!email, "set E2E_OWNER_EMAIL to run");
    await page.goto("/login");
    await page.getByLabel("Email").fill(email!);
    await page.getByLabel("Password").fill("definitely-not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    // Scoped to the form: Next's route announcer is also role="alert".
    await expect(page.locator("form").getByRole("alert")).toContainText(
      "Incorrect email or password",
    );
  });

  test("owner signs in and reaches the shell", async ({ page }) => {
    test.skip(!email || !password, "set E2E_OWNER_EMAIL and E2E_OWNER_PASSWORD to run");
    await page.goto("/login");
    await page.getByLabel("Email").fill(email!);
    await page.getByLabel("Password").fill(password!);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL("/");
    await expect(page.getByRole("tablist", { name: "Workspace mode" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Agent" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
