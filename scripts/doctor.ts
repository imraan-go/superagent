/**
 * `pnpm setup:doctor` — verifies local setup and credentials WITHOUT printing secret values.
 * Credential checks use free, read-only endpoints (Gateway credits, Composio auth-config list,
 * E2B sandbox list). Exit code 1 if a required local check fails.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Connection } from '@temporalio/client';
import { Sandbox } from 'e2b';
import pg from 'pg';
import { capabilityStatus, getEnv, modelAllowlist, REPO_ROOT } from '@superagent/config';
import { VercelGatewayModelProvider, checkModel, fetchGatewayCatalog } from '@superagent/agent';
import { ComposioConnector } from '@superagent/connectors';
import { CONNECTOR_CANDIDATES, CONNECTOR_LOCK, verifiedConnectorTools } from '@superagent/policy';
import { getArtifactStore } from '@superagent/storage';
import { temporalSettings } from '@superagent/temporal';

type Level = 'ok' | 'warn' | 'fail' | 'skip';
const results: Array<{ level: Level; name: string; detail: string }> = [];
const add = (level: Level, name: string, detail: string) => results.push({ level, name, detail });
const errText = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).replace(/(key|token|secret)=[^&\s]+/gi, '$1=[REDACTED]').slice(0, 200);

async function check(name: string, fn: () => Promise<[Level, string]>) {
  try {
    const [l, d] = await fn();
    add(l, name, d);
  } catch (e) {
    add('fail', name, errText(e));
  }
}

function listeners(port: number): string[] {
  try {
    return execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' })
      .split('\n')
      .slice(1)
      .filter(Boolean)
      .map((l) => l.trim().split(/\s+/).at(-2) ?? '');
  } catch {
    return [];
  }
}

const envPath = join(REPO_ROOT, '.env');
if (!existsSync(envPath)) add('fail', '.env', 'missing — run `pnpm setup:env`');
else {
  const mode = statSync(envPath).mode & 0o777;
  add(
    mode & 0o077 ? 'warn' : 'ok',
    '.env',
    mode & 0o077 ? `permissions ${mode.toString(8)}; run chmod 600 .env` : 'present, mode 600',
  );
}

let env;
try {
  env = getEnv();
  add('ok', 'config', `valid (APP_ENV=${env.APP_ENV}, TEMPORAL_MODE=${env.TEMPORAL_MODE})`);
} catch (e) {
  add('fail', 'config', errText(e));
}

const tools: Array<[string, string[]]> = [
  ['node', ['--version']],
  ['temporal', ['--version']],
  ['docker', ['info', '--format', '{{.ServerVersion}}']],
];
for (const [bin, args] of tools) {
  try {
    add('ok', bin, execFileSync(bin, args, { encoding: 'utf8' }).trim().split('\n')[0]!);
  } catch {
    add(bin === 'node' ? 'fail' : 'warn', bin, `not available — see docs/credentials-checklist.md`);
  }
}

if (env) {
  const caps = capabilityStatus(env);

  await check('postgres', async () => {
    if (!env.DATABASE_URL) return ['fail', 'DATABASE_URL not set — run `pnpm setup:env`'];
    const c = new pg.Client({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 3000 });
    await c.connect();
    try {
      const v = await c.query<{ v: string }>('select current_setting($1) as v', ['server_version']);
      const t = await c.query<{ n: number }>(
        "select count(*)::int as n from information_schema.tables where table_schema='public' and table_name in ('tasks','action_intents','user')",
      );
      return t.rows[0]!.n === 3
        ? ['ok', `PostgreSQL ${v.rows[0]!.v}, migrations applied`]
        : ['warn', `PostgreSQL ${v.rows[0]!.v}; run \`pnpm db:migrate\``];
    } finally {
      await c.end();
    }
  });

  await check('object storage (MinIO)', async () => {
    if (!caps.storage.configured) return ['fail', `missing ${caps.storage.missing.join(', ')}`];
    const h = await getArtifactStore().health();
    return [h.ok ? 'ok' : 'fail', h.detail];
  });

  await check('temporal', async () => {
    const s = temporalSettings(env);
    const conn = await Connection.connect({
      address: s.address,
      ...(s.tls !== undefined ? { tls: s.tls } : {}),
      ...(s.apiKey ? { apiKey: s.apiKey } : {}),
      connectTimeout: '3s',
    });
    try {
      await conn.workflowService.describeNamespace({ namespace: s.namespace });
      return ['ok', `${s.mode} ${s.address} namespace=${s.namespace}`];
    } finally {
      await conn.close();
    }
  });

  await check('loopback-only ports', async () => {
    const exposed: string[] = [];
    for (const p of [5432, 9000, 9001, 7233, 8233, 3000, 3001]) {
      for (const addr of listeners(p))
        if (!/^(127\.0\.0\.1|\[::1\]|localhost):/.test(addr)) exposed.push(`${p} on ${addr}`);
    }
    return exposed.length
      ? ['warn', `listening beyond loopback: ${exposed.join('; ')}`]
      : ['ok', 'Postgres, MinIO, Temporal, API and web bind to loopback (where running)'];
  });

  await check('vercel ai gateway', async () => {
    if (!env.AI_GATEWAY_API_KEY) return ['fail', 'AI_GATEWAY_API_KEY not set'];
    const credits = (await new VercelGatewayModelProvider({ apiKey: env.AI_GATEWAY_API_KEY }).credits()) as {
      balance?: string;
    };
    const cat = await fetchGatewayCatalog();
    const problems: string[] = [];
    const allow = modelAllowlist(env);
    for (const [label, id, req] of [
      ['primary', env.AI_MODEL_PRIMARY, ['tool-use']],
      ['browser', env.AI_MODEL_BROWSER, ['tool-use', 'vision']],
    ] as const) {
      const c = checkModel(cat, id, allow, [...req]);
      if (!c.ok) problems.push(`${label} ${c.modelId}: ${c.problems.join(', ')}`);
    }
    return problems.length
      ? ['fail', `key authenticates; ${problems.join(' | ')}`]
      : [
          'ok',
          `key authenticates (balance ${credits.balance ?? '?'} USD); models ${env.AI_MODEL_PRIMARY} validated (tools, vision, pricing)`,
        ];
  });

  await check('composio', async () => {
    if (!env.COMPOSIO_API_KEY) return ['warn', 'COMPOSIO_API_KEY not set — connectors disabled'];
    const r = (await new ComposioConnector(env.COMPOSIO_API_KEY).listAuthConfigs('github')) as { items?: unknown[] };
    const verified = verifiedConnectorTools().length;
    const lockNote = Object.keys(CONNECTOR_LOCK).length
      ? `${verified}/${CONNECTOR_CANDIDATES.length} catalogue tools verified`
      : 'no tools verified yet — run `pnpm composio:discover`';
    return [verified ? 'ok' : 'warn', `key authenticates (${r.items?.length ?? 0} github auth configs); ${lockNote}`];
  });

  await check('e2b', async () => {
    if (!env.E2B_API_KEY) return ['warn', 'E2B_API_KEY not set — workspace and browser tools disabled'];
    const pager = Sandbox.list({ apiKey: env.E2B_API_KEY, query: { metadata: { app: 'superagent' } } });
    const items = pager.hasNext ? await pager.nextItems() : [];
    const tmpl = env.E2B_BROWSER_TEMPLATE_ID
      ? `browser template ${env.E2B_BROWSER_TEMPLATE_ID}`
      : 'browser template not built — run `pnpm e2b:template:build`';
    return [
      env.E2B_BROWSER_TEMPLATE_ID ? 'ok' : 'warn',
      `key authenticates (${items.length} app sandboxes live); code template ${env.E2B_CODE_TEMPLATE_ID ?? 'base'}; ${tmpl}`,
    ];
  });

  add(
    caps.budget.configured ? 'ok' : 'fail',
    'budget limits',
    caps.budget.configured
      ? `per run ${env.MAX_COST_PER_RUN} USD, monthly ${env.MONTHLY_COST_LIMIT} USD, smoke ${env.LIVE_SMOKE_MAX_COST ?? 'unset'} USD`
      : 'set MAX_COST_PER_RUN and MONTHLY_COST_LIMIT',
  );
  add(
    env.APP_ENV === 'production' ? 'ok' : 'ok',
    'dev seed',
    env.APP_ENV === 'production'
      ? 'disabled (production)'
      : env.DEV_SEED_EMAIL
        ? `enabled for ${env.DEV_SEED_EMAIL} (development only)`
        : 'not configured',
  );
}

const icon: Record<Level, string> = { ok: 'OK  ', warn: 'WARN', fail: 'FAIL', skip: 'SKIP' };
for (const r of results) console.log(`${icon[r.level]}  ${r.name.padEnd(24)} ${r.detail}`);
const failed = results.filter((r) => r.level === 'fail');
console.log(failed.length ? `\n${failed.length} required check(s) failing.` : '\nAll required checks pass.');
process.exit(failed.length ? 1 : 0);
