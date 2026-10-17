import { serve } from '@hono/node-server';
import { getEnv, requireKeys } from '@superagent/config';
import { getComposio } from '@superagent/connectors';
import { getDb } from '@superagent/db';
import { createLogger } from '@superagent/observability';
import { getArtifactStore } from '@superagent/storage';
import { createApp } from './app';
import { createAuth } from './auth';

const log = createLogger('api');
const env = getEnv();
requireKeys(
  'database',
  ['DATABASE_URL', 'BETTER_AUTH_SECRET'],
  'Run `pnpm setup:env`, `pnpm infra:up` and `pnpm db:migrate`.',
);
const db = getDb();
const app = createApp({ db, env, auth: createAuth(db, env), log, store: getArtifactStore, connections: getComposio });

serve({ fetch: app.fetch, hostname: env.API_HOST, port: env.API_PORT }, (info) => {
  log.info('api.listening', { address: `http://${env.API_HOST}:${info.port}`, webOrigin: env.WEB_ORIGIN });
});
