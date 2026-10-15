import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Unit tests — pricing math, the retryable-error classifier, approval policy
 * matching, the Manage allowlist, crypto round-trips (IMPLEMENTATION_PLAN §6).
 * The default run never reaches the live LHOS server. `LHOS_LIVE=1` swaps in
 * the read-only contract smoke tests instead. Browser flows live in Playwright.
 */
export default defineConfig({
  test: {
    environment: "node",
    include:
      process.env.LHOS_LIVE === "1"
        ? ["tests/smoke/**/*.test.ts"]
        : ["src/**/*.test.ts", "tests/unit/**/*.test.ts"],
    testTimeout: process.env.LHOS_LIVE === "1" ? 180_000 : 5_000,
    reporters: "default",
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` is resolved by Next's bundler, not by Node. Server modules
      // under test import it as a guard, so it is stubbed here.
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
});
