import type { Config } from "drizzle-kit";

/**
 * drizzle-kit runs outside Next, so it reads the env directly rather than
 * through src/server/env.ts (which asserts the full runtime config).
 * Invoke with: npm run db:generate (see package.json scripts).
 */
const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL is not set. Run `bash scripts/sync-env.sh`, then re-run with\n" +
      "  node --env-file=.env.local ./node_modules/.bin/drizzle-kit generate",
  );
}

export default {
  schema: "./src/server/db/schema.ts",
  out: "./src/server/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
  verbose: true,
} satisfies Config;
