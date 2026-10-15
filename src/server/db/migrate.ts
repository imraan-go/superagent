/**
 * Applies pending Drizzle migrations. Run via `npm run db:migrate`.
 *
 * Extensions are ensured here as well as in docker/db-init, so migrating
 * against a database that was not created by this compose file still works.
 */
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set — run `bash scripts/sync-env.sh` first.");
  }

  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
    await pool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");

    await migrate(drizzle(pool), { migrationsFolder: "./src/server/db/migrations" });
    console.log("migrations applied");
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error("migration failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
