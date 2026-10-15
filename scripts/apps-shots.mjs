// Screenshots + sanity checks for Connect Apps against a local dev server (port 3117).
//   node scripts/apps-shots.mjs   (uses .env.local to mint an owner cookie; prints nothing secret)
import { readFileSync, mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";
import { sealData } from "iron-session";
import pg from "pg";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const db = new pg.Client({ connectionString: env.DATABASE_URL });
await db.connect();
const { rows } = await db.query("select id, email from users limit 1");
await db.end();
const value = await sealData({ userId: rows[0].id, email: rows[0].email, loggedInAt: Math.floor(Date.now() / 1000) }, { password: env.PANEL_SECRET_KEY, ttl: 3600 });

mkdirSync("test-results", { recursive: true });
const browser = await chromium.launch();
const results = {};
for (const [tag, viewport] of [["1440", { width: 1440, height: 900 }], ["390", { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport, colorScheme: "dark" });
  await ctx.addCookies([{ name: "fd_session", value, url: "http://localhost:3117" }]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));
  await page.goto("http://localhost:3117/", { waitUntil: "networkidle" });
  await page.screenshot({ path: `test-results/apps-landing-${tag}.png` });
  // Browse
  await page.waitForTimeout(2000);
  if (viewport.width < 600) await page.getByRole("button", { name: "Chat history" }).click();
  await page.locator("[data-apps-btn]").first().click();
  await page.getByRole("dialog", { name: "Connect apps" }).waitFor();
  await page.getByText("Recommended for you").waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `test-results/apps-modal-${tag}.png` });
  // Full-catalog browse + virtualization
  await page.getByRole("button", { name: /Browse all/ }).click();
  await page.waitForSelector('[role="list"][aria-label$="apps"]');
  const label = await page.locator('[role="list"][aria-label$="apps"]').getAttribute("aria-label");
  const domRows = await page.locator("[data-app-main]").count();
  results[tag] = { listLabel: label, domRows };
  // Search
  await page.getByLabel("Search across all apps").fill("google drive");
  await page.waitForTimeout(1500);
  results[tag].search = await page.locator('[role="status"]').first().innerText();
  // Detail
  await page.locator("[data-app-main]").first().click();
  await page.getByRole("heading", { name: "Information" }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  results[tag].url = page.url();
  await page.screenshot({ path: `test-results/apps-detail-${tag}.png` });
  // Manage
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: /connected\. Manage apps/ }).click();
  await page.getByRole("heading", { name: "Installed" }).waitFor();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `test-results/apps-manage-${tag}.png` });
  // Deep link
  await page.keyboard.press("Escape");
  await page.goto("http://localhost:3117/?app=slack", { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Information" }).waitFor({ timeout: 30000 });
  results[tag].deepLink = await page.locator("h3").first().innerText();
  results[tag].errors = errors.filter((e) => !/favicon/.test(e)).slice(0, 5);
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(results, null, 1));
