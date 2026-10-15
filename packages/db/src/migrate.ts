import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { closeDb, getDb } from './client';

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

async function main() {
  const db = getDb();
  await migrate(db as unknown as NodePgDatabase, { migrationsFolder: MIGRATIONS_DIR });
  console.log('migrations applied');
  await closeDb();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('migration failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
