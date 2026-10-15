import { expect, test } from "@playwright/test";
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { mintOwnerCookie, withDb } from "./support/prod-session";

/**
 * Production smoke against the deployed panel (https://hostx.h22t.com).
 *
 *   PANEL_PROD=1 npx playwright test
 *
 * Owner auth is a session minted in-process from the DB (no password needed).
 * Screenshots land in test-results/prod/. Everything created here (chats,
 * files, approvals) is deleted in afterAll. Never restarts/sleeps/wakes or
 * rotates anything; never drives the desktop.
 */
test.skip(process.env.PANEL_PROD !== "1", "set PANEL_PROD=1 to run the production smoke");
// Ordered by workers: 1 / fullyParallel: false; not serial, so one failing area does not skip the rest.

const HOST = "hostx.h22t.com";
const ORIGIN = `https://${HOST}`;
const SHOTS = "test-results/prod";
const created = { chats: new Set<string>(), files: new Set<string>() };
/**
 * Console errors / failed requests for the running test. Checked in afterEach
 * (a failed test restarts the worker, so a module-level tally would reset).
 */
let problems: string[] = [];

/** Collects console errors + failed requests; intended 4xx checks use `request`, not the page. */
function watch(page: Page, area: string) {
  page.on("console", (m) => {
    // Chrome reports this for the framed VNC sign-in page itself, not the panel.
    if (m.text().includes("Blocked autofocusing on a <input> element in a cross-origin subframe")) return;
    if (m.type() === "error") problems.push(`[${area}] console: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`[${area}] pageerror: ${e.message}`));
  page.on("requestfailed", (r) => {
    const err = r.failure()?.errorText ?? "";
    // Aborted RSC prefetches / EventSource closes on navigation are not failures.
    if (err.includes("ERR_ABORTED")) return;
    problems.push(`[${area}] requestfailed: ${r.method()} ${r.url()} ${err}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400 && r.url().startsWith(ORIGIN)) {
      problems.push(`[${area}] HTTP ${r.status()} ${r.request().method()} ${r.url()}`);
    }
  });
}

async function signedIn(context: BrowserContext) {
  await context.addCookies([await mintOwnerCookie(HOST)]);
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** Same-origin API call through the page's cookie jar. */
async function api(request: APIRequestContext, method: string, path: string, data?: unknown) {
  return request.fetch(`${ORIGIN}${path}`, {
    method,
    headers: { origin: ORIGIN, "content-type": "application/json" },
    data: data === undefined ? undefined : JSON.stringify(data),
  });
}

async function hold(page: Page, locator: ReturnType<Page["locator"]>, ms: number) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error("hold target not visible");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

function chatIdFrom(url: string): string | null {
  return /\/chat\/([0-9a-f-]{36})/.exec(url)?.[1] ?? null;
}

async function newChat(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New chat" }).click();
  // New chat creates the row first, then navigates (the prompt bar remounts).
  await page.waitForURL(/\/chat\/[0-9a-f-]{36}/, { timeout: 20_000 });
  const id = chatIdFrom(page.url())!;
  created.chats.add(id);
  await expect(page.getByRole("textbox", { name: "Message the agent" })).toBeEditable();
  return id;
}

async function sendInNewChat(page: Page, text: string) {
  const id = await newChat(page);
  await send(page, text);
  return id;
}

async function send(page: Page, text: string) {
  await page.getByRole("combobox", { name: "Model" }).selectOption("mock/echo");
  await page.getByRole("textbox", { name: "Message the agent" }).fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}

/** Run settled in the UI: activity line gone and Send is back (Stop gone). */
async function expectSettled(page: Page, timeout = 30_000) {
  await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0, { timeout });
}

/** How many SSE frames a browser EventSource.onmessage sees for a finished run. */
async function onmessageCount(page: Page, runId: string) {
  return page.evaluate(
    (rid) =>
      new Promise<number>((resolve) => {
        let n = 0;
        const es = new EventSource(`/api/runs/${rid}/events`);
        es.onmessage = () => n++;
        setTimeout(() => {
          es.close();
          resolve(n);
        }, 3000);
      }),
    runId,
  );
}

async function approvalStatus(id: string) {
  return withDb(async (c) => {
    const r = await c.query("select status from approvals where id = $1", [id]);
    return r.rows[0]?.status as string | undefined;
  });
}

async function latestRun(chatId: string) {
  return withDb(async (c) => {
    const r = await c.query("select id, status from runs where chat_id = $1 order by started_at desc limit 1", [chatId]);
    return r.rows[0] as { id: string; status: string } | undefined;
  });
}

/** "N model calls today" under Spend today — pushed over the usage SSE stream. */
function spendTokensIn(page: Page) {
  return page.getByText(/model calls today/).first().innerText();
}

test.afterAll(async ({ browser }) => {
  if (process.env.PROD_KEEP === "1") return; // debugging: leave artefacts in place
  const context = await browser.newContext();
  await signedIn(context);
  for (const id of created.chats) {
    await api(context.request, "DELETE", `/api/chats/${id}`).catch(() => undefined);
  }
  // Files have no delete API: remove rows created by this suite (blobs are content-addressed and tiny).
  if (created.files.size > 0) {
    await withDb((c) => c.query("delete from files where id = any($1::uuid[])", [[...created.files]]));
  }
  await context.close();
});

/* 1 ─ auth ─────────────────────────────────────────────────────────────── */
test("1 login page, unauthenticated redirect, minted session, splash once", async ({ page, context, request }) => {
  watch(page, "auth");
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Flight Deck" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await shot(page, "01-login");

  const anon = await request.get(`${ORIGIN}/api/auth/session`);
  expect(anon.status()).toBe(401);

  await signedIn(context);
  await page.goto("/");
  await expect(page.getByRole("tablist", { name: "Workspace mode" })).toBeVisible();

  // Splash: the login form arms it in sessionStorage; it must play once.
  await page.evaluate(() => sessionStorage.setItem("fd.splash", "pending"));
  await page.reload();
  const splash = page.getByRole("status", { name: "Starting Flight Deck" });
  await expect(splash).toBeVisible();
  await shot(page, "01-splash");
  await expect(splash).toBeHidden({ timeout: 10_000 });
  await page.reload();
  await page.waitForTimeout(800);
  await expect(splash).toHaveCount(0);
});

/* 2 ─ shell ────────────────────────────────────────────────────────────── */
test("2 shell: three columns, mode switch, connection Live, theme toggle", async ({ page, context }) => {
  watch(page, "shell");
  await signedIn(context);
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Chat history" })).toBeVisible();
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Mission panel" })).toBeVisible();

  const dot = page.getByRole("img", { name: /^Agent computer:/ });
  await expect(dot).toHaveAccessibleName("Agent computer: Live", { timeout: 20_000 });

  const html = page.locator("html");
  const before = await html.getAttribute("data-theme");
  await page.getByRole("button", { name: "Toggle theme" }).click();
  await expect(html).not.toHaveAttribute("data-theme", before ?? "");
  await shot(page, "02-theme-toggled");
  await page.getByRole("button", { name: "Toggle theme" }).click();
  if (before) await expect(html).toHaveAttribute("data-theme", before);

  await page.getByRole("tab", { name: "Manage" }).click();
  await expect(page).toHaveURL(/\/manage$/);
  await expect(html).toHaveAttribute("data-mode", "manage");
  await shot(page, "02-manage");
  await page.getByRole("tab", { name: "Agent" }).click();
  await expect(page).toHaveURL(/\/$/);
  await shot(page, "02-shell");
});

/* 3 ─ chat + SSE ───────────────────────────────────────────────────────── */
test("3 chat: mock stream, step chips, live spend ticker, sidebar, reattach", async ({ page, context }) => {
  watch(page, "chat");
  await signedIn(context);
  await page.goto("/");
  const spendBefore = await spendTokensIn(page);

  const id = await sendInNewChat(page, "e2e prod smoke hello");
  await expect(page.getByText(/Mock model here\. You said: "e2e prod smoke hello"/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("navigation", { name: "Chat history" }).locator(`a[href="/chat/${id}"]`)).toBeVisible();
  // Ticker is pushed over SSE (through Caddy) — it must change without a reload.
  await expect.poll(() => spendTokensIn(page), { timeout: 20_000 }).not.toBe(spendBefore);
  await shot(page, "03-chat-reply");

  // The run stream itself must reach EventSource.onmessage (live tokens, chips, settle).
  const first = await latestRun(id);
  expect(first?.status).toBe("done");
  expect.soft(await onmessageCount(page, first!.id), "run SSE frames seen by EventSource.onmessage").toBeGreaterThan(2);
  const settled = await page.getByRole("button", { name: "Stop" }).count().then((n) => n === 0);
  expect.soft(settled, "UI settles (Stop gone) after a finished run without reload").toBe(true);
  if (!settled) await page.reload();

  // Tool run that takes a few seconds: a harmless LHOS `wait`, reloaded mid-run.
  await send(page, '/tool wait {"seconds":6}');
  await expect.poll(async () => (await latestRun(id))?.status, { timeout: 20_000 }).toBe("running");
  await page.waitForTimeout(2000);
  await page.reload();
  const doneText = page.getByText("Done — the tool came back and I have recorded the result.");
  // Live: the reattached stream (Last-Event-ID) must deliver the rest of the run.
  const liveOk = await doneText
    .waitFor({ timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  expect.soft(liveOk, "reattached run streams to completion without another reload").toBe(true);
  if (!liveOk) {
    await expect.poll(async () => (await latestRun(id))?.status, { timeout: 30_000 }).toBe("done");
    await page.reload();
    await expect(doneText).toBeVisible({ timeout: 20_000 });
  }
  await expectSettled(page).catch(() => undefined);
  await page.waitForTimeout(1500);
  await expect(page.getByText("Done — the tool came back and I have recorded the result.")).toHaveCount(1);
  await expect(page.locator("main").getByRole("button", { name: /^wait/ })).toHaveCount(1);
  await shot(page, "03-chat-reattached");

  // Protocol check: replay with Last-Event-ID returns only later frames, no duplicates.
  const runId = await withDb(async (c) => {
    const r = await c.query("select id from runs where chat_id = $1 order by started_at desc limit 1", [id]);
    return r.rows[0].id as string;
  });
  const all = await page.evaluate(async (rid) => (await fetch(`/api/runs/${rid}/events`)).text(), runId);
  const seqs = [...all.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
  expect(seqs.length).toBeGreaterThan(2);
  expect(new Set(seqs).size).toBe(seqs.length);
  const mid = seqs[Math.floor(seqs.length / 2)]!;
  const rest = await page.evaluate(
    async ([rid, last]) =>
      (await fetch(`/api/runs/${rid}/events`, { headers: { "Last-Event-ID": String(last) } })).text(),
    [runId, mid] as const,
  );
  const restSeqs = [...rest.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
  expect(restSeqs.every((s) => s > mid)).toBe(true);
  expect(restSeqs).toEqual(seqs.filter((s) => s > mid));
});

/* 4 ─ approvals ────────────────────────────────────────────────────────── */
test("4 approvals: checkpoint card, hold-to-approve resumes, reject, 409, cross-origin 403", async ({
  page,
  context,
  request,
}) => {
  watch(page, "approvals");
  await signedIn(context);
  // http_request with POST is gated by argument; target is a closed loopback port (harmless on approve).
  const gated = '/tool http_request {"method":"POST","url":"http://127.0.0.1:9/e2e-smoke"}';

  const chatA = await sendInNewChat(page, gated);
  const approveBtn = page.getByRole("button", { name: /^Approve: .*http_request|^Approve: .*POST/i }).first();
  await expect(approveBtn).toBeVisible({ timeout: 30_000 });
  await shot(page, "04-waiting-card");
  const approvalA = await withDb(async (c) => {
    const r = await c.query(
      "select a.id from approvals a join runs r on r.id = a.run_id where r.chat_id = $1 order by a.created_at desc limit 1",
      [chatA],
    );
    return r.rows[0]?.id as string;
  });
  expect(approvalA).toBeTruthy();

  // Cross-origin decide is refused by middleware before any handler runs.
  const xo = await context.request.fetch(`${ORIGIN}/api/approvals/${approvalA}`, {
    method: "POST",
    headers: { origin: "https://evil.example", "content-type": "application/json" },
    data: JSON.stringify({ decision: "approve" }),
  });
  expect(xo.status()).toBe(403);

  await hold(page, approveBtn, 1800);
  await expect.poll(() => approvalStatus(approvalA), { timeout: 20_000 }).toBe("approved");
  const doneText = page.getByText("Done — the tool came back and I have recorded the result.");
  const liveOk = await doneText
    .waitFor({ timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  expect.soft(liveOk, "resumed run streams into the open chat without reload").toBe(true);
  await expect.poll(async () => (await latestRun(chatA))?.status, { timeout: 45_000 }).toBe("done");
  if (!liveOk) {
    await page.reload();
    await expect(doneText).toBeVisible({ timeout: 20_000 });
  }
  await shot(page, "04-approved-resumed");

  const again = await api(context.request, "POST", `/api/approvals/${approvalA}`, { decision: "reject" });
  expect(again.status()).toBe(409);

  // Second checkpoint → Reject.
  const chatB = await sendInNewChat(page, gated);
  const rejectBtn = page
    .getByRole("complementary", { name: "Mission panel" })
    .getByRole("button", { name: "Reject" })
    .first();
  await expect(rejectBtn).toBeVisible({ timeout: 30_000 });
  await rejectBtn.click();
  const approvalB = await withDb(async (c) => {
    const r = await c.query(
      "select a.id from approvals a join runs r on r.id = a.run_id where r.chat_id = $1 order by a.created_at desc limit 1",
      [chatB],
    );
    return r.rows[0]?.id as string;
  });
  await expect.poll(() => approvalStatus(approvalB), { timeout: 20_000 }).toBe("rejected");
  await expect.poll(async () => (await latestRun(chatB))?.status, { timeout: 45_000 }).toBe("done");
  await page.reload();
  await shot(page, "04-rejected");
  void request;
});

/* 5 ─ computer tab ─────────────────────────────────────────────────────── */
test("5 computer tab: framed viewer, take control, expand, Esc releases", async ({ page, context }) => {
  watch(page, "computer");
  await signedIn(context);
  await page.goto("/");
  await page.getByRole("tab", { name: "Computer" }).click();
  const frame = page.locator('iframe[title="Agent computer live view"]');
  await expect(frame).toBeVisible({ timeout: 30_000 });
  await expect(frame).toHaveAttribute("src", /^https:\/\/vnc\.hostx\.h22t\.com\//);
  // Framed, not blocked: the frame must have a real document from the viewer origin.
  const inner = page.frameLocator('iframe[title="Agent computer live view"]');
  await expect(inner.locator("body")).not.toBeEmpty({ timeout: 20_000 });
  await shot(page, "05-computer-framed");

  await hold(page, page.getByRole("button", { name: "Take control of the agent computer" }), 1000);
  await expect(page.getByRole("status").filter({ hasText: "LIVE CONTROL" })).toBeVisible();
  await page.getByRole("button", { name: "Expand view" }).click();
  await expect(page.getByRole("dialog", { name: "Agent computer, full view" })).toBeVisible();
  await shot(page, "05-computer-control-expanded");
  // Focus must be outside the iframe for Esc to reach the panel.
  await page.getByRole("dialog", { name: "Agent computer, full view" }).locator("span").first().click({ force: true });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("status").filter({ hasText: "LIVE CONTROL" })).toHaveCount(0);
  await shot(page, "05-computer-released");
});

/* 6 ─ uploads ──────────────────────────────────────────────────────────── */
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("6 uploads: image + csv chips, message parts, Library, nosniff", async ({ page, context }) => {
  watch(page, "uploads");
  await signedIn(context);
  const chatId = await newChat(page);
  const stamp = Date.now();
  await page.locator('input[type="file"]').first().setInputFiles([
    { name: `e2e-${stamp}.png`, mimeType: "image/png", buffer: PNG_1x1 },
    { name: `e2e-${stamp}.csv`, mimeType: "text/csv", buffer: Buffer.from(`a,b\n${stamp},2\n`) },
  ]);
  const chips = page.getByRole("list", { name: "Attachments" });
  await expect(chips.getByRole("listitem")).toHaveCount(2, { timeout: 20_000 });
  await shot(page, "06-upload-chips");

  await send(page, "e2e attachments");
  await expect(page.locator("main").getByRole("list", { name: "Attachments" })).toBeVisible({ timeout: 20_000 });

  const files = await page.evaluate(async (id) => (await fetch(`/api/chats/${id}/files`)).json(), chatId);
  const ours = (files.files as Array<{ id: string; name: string; mime: string }>).filter((f) =>
    f.name.startsWith(`e2e-${stamp}`),
  );
  expect(ours.map((f) => f.mime).sort()).toEqual(["image/png", "text/csv"]);
  for (const f of ours) created.files.add(f.id);

  await page.getByRole("tab", { name: "Library" }).click();
  await expect(page.getByRole("button", { name: `Open e2e-${stamp}.png` })).toBeVisible();
  await expect(page.getByText(`e2e-${stamp}.csv`).last()).toBeVisible();
  await shot(page, "06-library");

  for (const f of ours) {
    const res = await context.request.get(`${ORIGIN}/api/uploads/${f.id}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
    expect(res.headers()["content-type"]).toContain(f.mime);
  }
});

/* 7 ─ settings ─────────────────────────────────────────────────────────── */
test("7 settings: every tab opens without errors (read-only)", async ({ page, context }) => {
  watch(page, "settings");
  await signedIn(context);
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  const nav = page.getByRole("navigation", { name: "Settings sections" });
  await expect(nav).toBeVisible();
  const tabs = [
    "Models",
    "Usage",
    "Agent",
    "Approvals & Takeover",
    "Schedules",
    "Triggers & Webhooks",
    "Connectors",
    "Memories",
    "Appearance",
    "Notifications & Sound",
    "Data",
    "Danger zone",
  ];
  for (const name of tabs) {
    await nav.getByRole("button", { name, exact: true }).or(nav.getByRole("tab", { name, exact: true })).or(nav.getByRole("link", { name, exact: true })).first().click();
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.waitForTimeout(700);
    await expect(page.getByRole("dialog").getByRole("alert")).toHaveCount(0);
    await shot(page, `07-settings-${name.split(" ")[0]!.toLowerCase()}`);
  }
});

/* 8 ─ manage ───────────────────────────────────────────────────────────── */
test("8 manage: every section loads real data (read-only)", async ({ page, context }) => {
  watch(page, "manage");
  await signedIn(context);
  await page.goto("/manage");
  const nav = page.getByRole("navigation", { name: "Manage sections" });
  await expect(nav).toBeVisible();

  const services = await page.evaluate(async () => (await fetch("/api/manage/services")).json());
  const units = (services.services ?? services.units ?? services.items ?? []) as unknown[];
  expect(units.length).toBe(9);
  await page.waitForTimeout(2500);
  await shot(page, "08-manage-overview");

  for (const name of [
    "Activity & reports",
    "Persistent data",
    "Snapshots",
    "Schedules",
    "System",
    "Logs",
    "HITL inbox",
  ]) {
    await nav.getByRole("link", { name, exact: true }).or(nav.getByRole("button", { name, exact: true })).first().click();
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.waitForTimeout(1500);
    await shot(page, `08-manage-${name.split(" ")[0]!.toLowerCase()}`);
  }

  // Logs: follow streams new lines over SSE.
  await nav.getByRole("button", { name: "Logs", exact: true }).click();
  const follow = page.getByRole("checkbox", { name: "Follow", exact: true });
  await follow.check();
  await expect(page.getByText("following", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel("Log output")).not.toBeEmpty({ timeout: 15_000 });
  await shot(page, "08-manage-logs-follow");
  await follow.uncheck();

  // Every read endpoint answers 200 with data.
  for (const path of [
    "/api/manage/stats",
    "/api/manage/desktop",
    "/api/lhos/events?limit=5",
    "/api/manage/reports",
    "/api/manage/files",
    "/api/manage/snapshots",
    "/api/manage/schedules",
    "/api/manage/config",
    "/api/manage/audit",
  ]) {
    const status = await page.evaluate(async (p) => (await fetch(p)).status, path);
    expect.soft(status, path).toBe(200);
  }
});

/* 9 ─ console: enforced per area ────────────────────────────────────── */
test.beforeEach(() => {
  problems = [];
});

test.afterEach(async ({}, testInfo) => {
  if (problems.length > 0) {
    await testInfo.attach("console-and-network", { body: problems.join("\n"), contentType: "text/plain" });
  }
  expect.soft(problems, "zero console errors and no unintended failed requests").toEqual([]);
});
