/**
 * Development-only seed: creates one email/password user from DEV_SEED_EMAIL / DEV_SEED_PASSWORD
 * in the gitignored .env. Refuses to run when APP_ENV=production (config validation also rejects
 * seed credentials in production). Never prints the password.
 */
import { getEnv } from '@superagent/config';
import { closeDb, getDb, schema } from '@superagent/db';
import { eq } from 'drizzle-orm';
import { createAuth } from './auth';

async function main() {
  const env = getEnv();
  if (env.APP_ENV === 'production') throw new Error('db:seed:dev is disabled in production');
  if (!env.DEV_SEED_EMAIL || !env.DEV_SEED_PASSWORD) throw new Error('Set DEV_SEED_EMAIL and DEV_SEED_PASSWORD in .env (pnpm setup:env generates them).');
  const db = getDb();
  const existing = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, env.DEV_SEED_EMAIL.toLowerCase())).limit(1);
  if (existing[0]) {
    console.log(`dev user already exists: ${env.DEV_SEED_EMAIL}`);
  } else {
    const auth = createAuth(db, { ...env, ALLOW_SIGNUP: true });
    await auth.api.signUpEmail({ body: { email: env.DEV_SEED_EMAIL, password: env.DEV_SEED_PASSWORD, name: 'Dev User' } });
    console.log(`created dev user: ${env.DEV_SEED_EMAIL} (password is in .env as DEV_SEED_PASSWORD)`);
  }
  await closeDb();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
