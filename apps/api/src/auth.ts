import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import type { AppEnv } from '@superagent/config';
import { schema, type Db } from '@superagent/db';

/**
 * Email/password auth with database sessions. The browser talks to the web origin only; Next.js
 * proxies /api/* here, so cookies are first-party on the web origin.
 */
export function createAuth(db: Db, env: AppEnv) {
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) {
    throw new Error('BETTER_AUTH_SECRET must be set (>= 32 chars). Run `pnpm setup:env`.');
  }
  return betterAuth({
    appName: 'Superagent',
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.WEB_ORIGIN,
    basePath: '/api/auth',
    trustedOrigins: [env.WEB_ORIGIN],
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: !env.ALLOW_SIGNUP,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      autoSignIn: true,
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    rateLimit: { enabled: env.APP_ENV !== 'test', window: 60, max: 30 },
    advanced: {
      useSecureCookies: env.APP_ENV === 'production',
      defaultCookieAttributes: { sameSite: 'lax', httpOnly: true },
    },
    telemetry: { enabled: false },
  });
}

export type Auth = ReturnType<typeof createAuth>;
