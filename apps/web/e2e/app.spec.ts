import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

// Throwaway users (never the dev user). Auth endpoints are rate limited, so each user signs up once
// and the session is reused across tests.
test.describe.configure({ mode: 'serial' });

let ctx: BrowserContext;
let page: Page;

async function signUp(p: Page, tag: string) {
  await p.goto('/login');
  await p.getByRole('button', { name: 'Create an account' }).click();
  await p.getByLabel('Email').fill(`e2e-${tag}-${randomUUID().slice(0, 8)}@example.com`);
  await p.getByLabel('Password').fill('e2e password 1234567');
  await p.getByRole('button', { name: 'Create account' }).click();
  await expect(p.getByRole('heading', { name: /What should the agent do/ })).toBeVisible();
}

/** Opens Settings on a tab and returns the dialog, so lookups never match the page behind it. */
async function openSettings(p: Page, tab: string) {
  await p.getByRole('button', { name: 'Settings', exact: true }).first().click();
  const dialog = p.getByRole('dialog');
  await dialog.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: tab }).click();
  return dialog;
}

test.beforeAll(async ({ browser }) => {
  ctx = await browser.newContext();
  page = await ctx.newPage();
  await signUp(page, 'owner');
});

test.afterAll(async () => {
  await ctx?.close();
});

test('unauthenticated users are sent to the login page', async ({ browser }) => {
  const anon = await browser.newPage();
  await anon.goto('/');
  await expect(anon).toHaveURL(/\/login$/);
  await anon.goto('/manage');
  await expect(anon).toHaveURL(/\/login\?next=%2Fmanage$/);
  await anon.close();
});

test('memories can be added and edited from Settings', async () => {
  await page.goto('/');
  const d = await openSettings(page, 'Memories');
  await d.getByPlaceholder('Add a memory').fill('I prefer meetings after 10am');
  await d.getByRole('button', { name: 'Remember', exact: true }).click();
  await expect(d.getByText('I prefer meetings after 10am')).toBeVisible();
  await d.getByRole('button', { name: 'Edit', exact: true }).click();
  await d.getByLabel('Edit memory').fill('I prefer meetings after 11am');
  await d.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(d.getByText('I prefer meetings after 11am')).toBeVisible();
  await expect(d.getByText(/added by you/)).toBeVisible();
});

test('routines are read-only and validate timezones', async () => {
  await page.goto('/');
  const d = await openSettings(page, 'Routines');
  await expect(d.getByText(/Routines run read-only/)).toBeVisible();
  const status = await page.evaluate(
    async () =>
      (
        await fetch('/api/schedules', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Bad', prompt: 'x', spec: { kind: 'cron', cron: '0 8 * * 1-5' }, timezone: 'Mars/Olympus' }),
        })
      ).status,
  );
  expect(status).toBe(400);
});

test('setup is shown without secret values', async () => {
  await page.goto('/');
  const d = await openSettings(page, 'Models & setup');
  await expect(d.getByText('Vercel AI Gateway (models)')).toBeVisible();
  expect(await page.content()).not.toMatch(/vck_|sk-[A-Za-z0-9]{10}|e2b_[A-Za-z0-9]{10}|ak_[A-Za-z0-9]{10}/);
});

test('the Workspaces view reports health', async () => {
  await page.goto('/manage');
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.getByText('Model gateway')).toBeVisible();
});

test('a user cannot read or change another user’s chats or memories', async ({ browser }) => {
  const chatId = await page.evaluate(async () => ((await (await fetch('/api/chats', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json()) as { chat: { id: string } }).chat.id);
  const memId = await page.evaluate(async () => ((await (await fetch('/api/memories')).json()) as { memories: Array<{ id: string }> }).memories[0]!.id);

  const otherCtx = await browser.newContext();
  const other = await otherCtx.newPage();
  await signUp(other, 'intruder');
  expect(await other.evaluate(async (id) => (await fetch(`/api/memories/${id}`, { method: 'DELETE' })).status, memId)).toBe(404);
  expect(await other.evaluate(async () => ((await (await fetch('/api/memories')).json()) as { memories: unknown[] }).memories.length)).toBe(0);
  expect(await other.evaluate(async (id) => (await fetch(`/api/chats/${id}`)).status, chatId)).toBe(404);
  expect(
    await other.evaluate(async (id) => (await fetch(`/api/chats/${id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'hijack' }) })).status, chatId),
  ).toBe(404);
  const res = await other.goto(`/chat/${chatId}`);
  expect(res?.status()).toBe(404);
  await otherCtx.close();
});
