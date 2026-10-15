import { drizzle } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { requireKeys } from '@superagent/config';
import * as schema from './schema';

export type Schema = typeof schema;
// Works for both node-postgres (runtime) and PGlite (tests).
export type Db = PgDatabase<PgQueryResultHKT, Schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

let pool: pg.Pool | undefined;
let db: Db | undefined;

export function getDb(): Db {
  if (db) return db;
  const { DATABASE_URL } = requireKeys('database', ['DATABASE_URL'], 'Run `pnpm setup:env` and `pnpm infra:up`.');
  pool = new pg.Pool({ connectionString: DATABASE_URL, max: 10, idleTimeoutMillis: 30_000 });
  db = drizzle(pool, { schema }) as unknown as Db;
  return db;
}

export function getPool(): pg.Pool {
  getDb();
  return pool!;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
  db = undefined;
}
