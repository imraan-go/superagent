import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

// Throwaway users (never the dev user). Auth endpoints are rate limited, so each user signs up once
// and the session is reused across tests.
test.describe.configure({ mode: 'serial' });

let ctx: BrowserContext;
let page: Page;

async function signUp(p: Page, tag: string) {
  await p.goto('/login');
  await p.getByText('Create an account').click();
  await p.getByLabel('Email').fill(`e2e-${tag}-${randomUUID().slice(0, 8)}@example.com`);
  await p.getByLabel('Password').fill('e2e password 1234567');
  await p.getByRole('button', { name: 'Create account' }).click();
  await expect(p.getByRole('heading', { name: 'Tasks' })).toBeVisible();
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
  await anon.close();
});

test('memory can be added, edited and permanently deleted', async () => {
  await page.goto('/memory');
  await page.getByLabel('New memory').fill('I prefer meetings after 10am');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByTestId('memory')).toContainText('after 10am');
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Edit memory').fill('I prefer meetings after 11am');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('memory')).toContainText('after 11am');
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByTestId('memory')).toHaveCount(0);
});

test('schedules validate timezones and are read-only', async () => {
  await page.goto('/schedules');
  await expect(page.getByText('Scheduled runs are read-only')).toBeVisible();
  await page.getByLabel('Name').fill('Morning brief');
  await page.getByLabel('Instructions').fill('Summarise my day');
  await page.getByLabel('Timezone (IANA)').fill('Mars/Olympus');
  await page.getByRole('button', { name: 'Create schedule' }).click();
  await expect(page.locator('.error')).toBeVisible();
});

test('settings show configured capabilities without secret values', async () => {
  await page.goto('/settings');
  await expect(page.getByText('gateway', { exact: true })).toBeVisible();
  expect(await page.content()).not.toMatch(/vck_|sk-[A-Za-z0-9]{10}|e2b_[A-Za-z0-9]{10}/);
});

test('a user cannot read or delete another user’s data', async ({ browser }) => {
  const status = await page.evaluate(async () => (await fetch('/api/memories', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'owner secret note' }) })).status);
  expect(status).toBe(201);
  const memId = await page.evaluate(async () => ((await (await fetch('/api/memories')).json()) as { memories: Array<{ id: string }> }).memories[0]!.id);

  const otherCtx = await browser.newContext();
  const other = await otherCtx.newPage();
  await signUp(other, 'intruder');
  expect(await other.evaluate(async (id) => (await fetch(`/api/memories/${id}`, { method: 'DELETE' })).status, memId)).toBe(404);
  expect(await other.evaluate(async () => ((await (await fetch('/api/memories')).json()) as { memories: unknown[] }).memories.length)).toBe(0);
  await otherCtx.close();
});
