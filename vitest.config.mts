import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Unit tests only — pricing math, the retryable-error classifier, approval
 * policy matching, the Manage allowlist, crypto round-trips
 * (IMPLEMENTATION_PLAN §6). Tests never reach the live LHOS server; the client
 * is injected. Browser flows live in Playwright.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts"],
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
