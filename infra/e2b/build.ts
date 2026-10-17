/**
 * `pnpm e2b:template:build [--only=browser|code]` — builds the E2B templates and records their IDs
 * (non-secret) in the gitignored .env. Requires E2B_API_KEY; the key is never printed.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Template, defaultBuildLogger } from 'e2b';
import { getEnv } from '@superagent/config';
import { BROWSER_TEMPLATE_NAME, CODE_TEMPLATE_NAME, browserTemplate, codeTemplate } from './src/index';

const env = getEnv();
if (!env.E2B_API_KEY) {
  console.error('E2B_API_KEY is not configured. Run `pnpm setup:secret E2B_API_KEY` first.');
  process.exit(2);
}
const only = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length);
const envPath = join(import.meta.dirname, '..', '..', '.env');

function upsertEnv(key: string, value: string) {
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, 'utf8').split('\n');
  const i = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (i >= 0) lines[i] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
  writeFileSync(envPath, lines.join('\n'), { mode: 0o600 });
}

const targets = [
  {
    kind: 'browser',
    name: BROWSER_TEMPLATE_NAME,
    tpl: browserTemplate(),
    key: 'E2B_BROWSER_TEMPLATE_ID',
    cpuCount: 2,
    memoryMB: 2048,
  },
  {
    kind: 'code',
    name: CODE_TEMPLATE_NAME,
    tpl: codeTemplate(),
    key: 'E2B_CODE_TEMPLATE_ID',
    cpuCount: 2,
    memoryMB: 1024,
  },
].filter((t) => !only || t.kind === only);

for (const t of targets) {
  console.log(`building ${t.name}…`);
  const started = Date.now();
  const info = await Template.build(t.tpl, t.name, {
    apiKey: env.E2B_API_KEY,
    cpuCount: t.cpuCount,
    memoryMB: t.memoryMB,
    onBuildLogs: defaultBuildLogger({ minLevel: 'info' }),
  });
  console.log(
    `built ${t.name}: template ${info.templateId}, build ${info.buildId} in ${Math.round((Date.now() - started) / 1000)}s`,
  );
  upsertEnv(t.key, t.name);
  console.log(`${t.key}=${t.name} recorded in .env`);
}
