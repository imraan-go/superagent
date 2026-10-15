/**
 * Creates/updates the gitignored .env from .env.example and generates LOCAL-ONLY secrets
 * (database, MinIO, Better Auth, dev seed). Existing values are never overwritten and no secret
 * value is printed. Third-party keys are left blank: add them with `pnpm setup:secret KEY`.
 */
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const envPath = join(root, '.env');
const example = readFileSync(join(root, '.env.example'), 'utf8');
const current = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';

function parse(text: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const line of text.split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) m.set(match[1]!, match[2]!);
  }
  return m;
}

const have = parse(current);
const secret = (n = 24) => randomBytes(n).toString('base64url');
const generated: Record<string, () => string> = {
  POSTGRES_PASSWORD: () => secret(),
  BETTER_AUTH_SECRET: () => secret(32),
  S3_ACCESS_KEY_ID: () => 'superagent',
  S3_SECRET_ACCESS_KEY: () => secret(),
  DEV_SEED_EMAIL: () => 'dev@superagent.local',
  DEV_SEED_PASSWORD: () => secret(18),
};

const values = new Map(have);
const created: string[] = [];
for (const [k, gen] of Object.entries(generated)) {
  if (!values.get(k)) {
    values.set(k, gen());
    created.push(k);
  }
}
if (!values.get('DATABASE_URL')) {
  values.set('DATABASE_URL', `postgres://superagent:${values.get('POSTGRES_PASSWORD')}@127.0.0.1:5432/superagent`);
  created.push('DATABASE_URL');
}

// Rebuild from the example so new keys appear in order; keep any extra keys the user added.
const out: string[] = [];
const seen = new Set<string>();
for (const line of example.split('\n')) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (!match) {
    out.push(line);
    continue;
  }
  const key = match[1]!;
  seen.add(key);
  out.push(`${key}=${values.has(key) ? values.get(key) : match[2]}`);
}
const extras = [...values.keys()].filter((k) => !seen.has(k));
if (extras.length) out.push('', '# --- Additional keys ---', ...extras.map((k) => `${k}=${values.get(k)}`));

writeFileSync(envPath, out.join('\n'), { mode: 0o600 });
chmodSync(envPath, 0o600);

const blanks = ['AI_GATEWAY_API_KEY', 'COMPOSIO_API_KEY', 'E2B_API_KEY', 'E2B_BROWSER_TEMPLATE_ID'].filter((k) => !values.get(k) && !process.env[k]);
console.log(`.env ready (mode 600). Generated: ${created.length ? created.join(', ') : 'nothing new'}.`);
if (blanks.length) console.log(`Not set yet (add with \`pnpm setup:secret KEY\`): ${blanks.join(', ')}`);
