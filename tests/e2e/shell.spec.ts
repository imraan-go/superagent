import { expect, test } from "@playwright/test";
import type { ConsoleMessage, Page } from "@playwright/test";

/**
 * Phase 1 acceptance for the shell: the connection dot reflects real LHOS
 * state, and the app hydrates cleanly.
 *
 *   E2E_OWNER_EMAIL=… E2E_OWNER_PASSWORD=… npm run e2e
 */
const email = process.env.E2E_OWNER_EMAIL;
const password = process.env.E2E_OWNER_PASSWORD;

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email!);
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");
}

test.describe("app shell", () => {
  test.skip(!email || !password, "set E2E_OWNER_EMAIL and E2E_OWNER_PASSWORD to run");

  test("hydrates without console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg: ConsoleMessage) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    await signIn(page);
    // Hydration mismatches are reported after the first client render.
    await page.waitForTimeout(1500);

    expect(errors).toEqual([]);
  });

  test("connection dot resolves to a real LHOS state", async ({ page }) => {
    await signIn(page);

    const dot = page.getByRole("img", { name: /^Agent computer:/ });
    await expect(dot).toBeVisible();

    // Must leave "Connecting" — a dot stuck on pending means the proxy failed.
    await expect(dot).not.toHaveAccessibleName("Agent computer: Connecting", {
      timeout: 15_000,
    });
    await expect(dot).toHaveAccessibleName(
      /Agent computer: (Live|Waking|Asleep|Offline)/,
    );
  });

  test("mode switch opens Manage and returns to Agent", async ({ page }) => {
    await signIn(page);

    await page.getByRole("tab", { name: "Manage" }).click();
    await expect(page).toHaveURL(/\/manage$/);
    await expect(page.locator("html")).toHaveAttribute("data-mode", "manage");
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Manage sections" })).toBeVisible();

    await page.getByRole("tab", { name: "Agent" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("html")).toHaveAttribute("data-mode", "agent");
  });

  test("landing shows a prompt bar and the mission rail", async ({ page }) => {
    await signIn(page);

    await expect(page.getByRole("heading", { name: "What should the agent do?" })).toBeVisible();
    await expect(page.getByLabel("Message the agent")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Agent computer" })).toBeVisible();
  });

  test("settings modal opens from the sidebar foot", async ({ page }) => {
    await signIn(page);

    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Appearance" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByRole("tablist", { name: "Theme" })).toBeVisible();
  });
});
