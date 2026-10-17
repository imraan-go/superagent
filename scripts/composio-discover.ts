/**
 * `pnpm composio:discover` — verifies every curated connector candidate against this Composio
 * project's live tool catalogue and writes packages/policy/src/connector-catalog.lock.json.
 * A tool is only offered to the model once it is locked here (slug exists, not deprecated, toolkit
 * version pinned, every curated parameter present upstream). Uses no end-user tokens.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, getEnv } from '@superagent/config';
import { ComposioConnector } from '@superagent/connectors';
import { CONNECTOR_CANDIDATES, type LockEntry } from '@superagent/policy';

const env = getEnv();
if (!env.COMPOSIO_API_KEY) {
  console.error('COMPOSIO_API_KEY is not configured. Run `pnpm setup:secret COMPOSIO_API_KEY` first.');
  process.exit(2);
}

const composio = new ComposioConnector(env.COMPOSIO_API_KEY, {});
const lock: Record<string, LockEntry> = {};
const report: Array<{ slug: string; toolkit: string; status: string; detail: string }> = [];

for (const c of CONNECTOR_CANDIDATES) {
  try {
    const tool = (await composio.describeTool(c.slug)) as {
      slug: string;
      version?: string;
      isDeprecated?: boolean;
      toolkit?: { slug: string };
      inputParameters?: { properties?: Record<string, unknown> };
    };
    const toolkit = tool.toolkit?.slug?.toLowerCase();
    const params = Object.keys(tool.inputParameters?.properties ?? {});
    const curated = Object.keys(c.schema.shape);
    const missing = curated.filter((p) => !params.includes(p));
    if (toolkit !== c.toolkit)
      report.push({ slug: c.slug, toolkit: c.toolkit, status: 'rejected', detail: `toolkit mismatch (${toolkit})` });
    else if (tool.isDeprecated)
      report.push({ slug: c.slug, toolkit: c.toolkit, status: 'rejected', detail: 'deprecated upstream' });
    else if (!tool.version)
      report.push({ slug: c.slug, toolkit: c.toolkit, status: 'rejected', detail: 'no toolkit version reported' });
    else if (missing.length)
      report.push({
        slug: c.slug,
        toolkit: c.toolkit,
        status: 'rejected',
        detail: `curated params missing upstream: ${missing.join(', ')}`,
      });
    else {
      lock[c.slug] = { toolkit: c.toolkit, version: tool.version, verifiedAt: new Date().toISOString(), params };
      report.push({ slug: c.slug, toolkit: c.toolkit, status: 'verified', detail: `version ${tool.version}` });
    }
  } catch (e) {
    report.push({
      slug: c.slug,
      toolkit: c.toolkit,
      status: 'rejected',
      detail: `lookup failed: ${(e as Error).message.slice(0, 160)}`,
    });
  }
}

const versions = new Map<string, Set<string>>();
for (const e of Object.values(lock)) versions.set(e.toolkit, (versions.get(e.toolkit) ?? new Set()).add(e.version));
for (const [tk, vs] of versions)
  if (vs.size > 1)
    console.warn(
      `WARN ${tk}: tools report different versions (${[...vs].join(', ')}); the session pins one toolkit version`,
    );

writeFileSync(join(REPO_ROOT, 'packages/policy/src/connector-catalog.lock.json'), JSON.stringify(lock, null, 2) + '\n');
mkdirSync(join(REPO_ROOT, '.local'), { recursive: true });
writeFileSync(
  join(REPO_ROOT, '.local/composio-discovery.json'),
  JSON.stringify({ at: new Date().toISOString(), report }, null, 2),
);
for (const r of report) console.log(`${r.status === 'verified' ? 'OK  ' : 'SKIP'}  ${r.slug.padEnd(52)} ${r.detail}`);
console.log(`\n${Object.keys(lock).length}/${CONNECTOR_CANDIDATES.length} tools verified and locked.`);
