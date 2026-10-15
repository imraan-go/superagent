/**
 * `pnpm setup:secret KEY` — prompts for a value with hidden input and writes it to the gitignored
 * .env. The value is never echoed, logged or passed on the command line (shell history).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ALLOWED = new Set([
  'AI_GATEWAY_API_KEY',
  'COMPOSIO_API_KEY',
  'E2B_API_KEY',
  'E2B_BROWSER_TEMPLATE_ID',
  'E2B_CODE_TEMPLATE_ID',
  'TEMPORAL_API_KEY',
  'COMPOSIO_AUTH_CONFIG_GITHUB',
  'COMPOSIO_AUTH_CONFIG_GOOGLECALENDAR',
  'COMPOSIO_AUTH_CONFIG_GOOGLEDRIVE',
  'COMPOSIO_AUTH_CONFIG_GMAIL',
  'COMPOSIO_AUTH_CONFIG_NOTION',
]);

const key = process.argv[2];
if (!key || !ALLOWED.has(key)) {
  console.error(`usage: pnpm setup:secret <${[...ALLOWED].join('|')}>`);
  process.exit(2);
}
const envPath = join(import.meta.dirname, '..', '.env');
if (!existsSync(envPath)) {
  console.error('Run `pnpm setup:env` first.');
  process.exit(2);
}

async function readHidden(prompt: string): Promise<string> {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const c of stdin) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString('utf8').trim();
  }
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  let value = '';
  return new Promise((resolve) => {
    const onData = (buf: Buffer) => {
      for (const ch of buf.toString('utf8')) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          stdout.write('\n');
          resolve(value.trim());
          return;
        }
        if (ch === '\u0003') process.exit(130);
        if (ch === '\u007f') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

const value = await readHidden(`${key} (input hidden): `);
if (!value || /[\r\n]/.test(value)) {
  console.error('empty or multi-line value; nothing written');
  process.exit(1);
}
const lines = readFileSync(envPath, 'utf8').split('\n');
let found = false;
const next = lines.map((l) => {
  if (l.startsWith(`${key}=`)) {
    found = true;
    return `${key}=${value}`;
  }
  return l;
});
if (!found) next.push(`${key}=${value}`);
writeFileSync(envPath, next.join('\n'), { mode: 0o600 });
console.log(`${key} saved to .env (${value.length} chars). Run \`pnpm setup:doctor\` to verify it works.`);
