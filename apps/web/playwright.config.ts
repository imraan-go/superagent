import { defineConfig } from '@playwright/test';

/**
 * E2E against the running local stack (`pnpm dev` + `pnpm worker:dev`), driving the locally
 * installed Google Chrome (channel "chrome") as the test client. The agent's own browsing runs in
 * Google Chrome inside E2B, never on this machine.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000', trace: 'retain-on-failure', channel: 'chrome', headless: true },
});
