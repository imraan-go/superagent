import { defineConfig, devices } from "@playwright/test";

/**
 * Browser smoke tests against a running dev server: login → shell, plus the
 * flows added in each phase (chat, tool call, approval round-trip).
 *
 * `reuseExistingServer` keeps a dev server already running on 3100 — starting a
 * second Next build on this host would contend for memory (risk R2).
 */
const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 30_000,
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
