import "server-only";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { env } from "@/server/env";
import * as schema from "./schema";

/**
 * One pool per process. Next's dev server re-evaluates modules on every edit,
 * so the pool is cached on `globalThis` to avoid exhausting Postgres
 * connections during development.
 */
const globalForDb = globalThis as unknown as { __fdPool?: Pool };

const pool =
  globalForDb.__fdPool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: "tj-lhos-panel",
  });

if (env.NODE_ENV !== "production") globalForDb.__fdPool = pool;

export const db = drizzle(pool, { schema });
export { pool, schema };
export type Db = typeof db;
