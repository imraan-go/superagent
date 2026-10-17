/**
 * `pnpm cleanup:cloud [--yes]` — lists every E2B sandbox tagged for this app and, with --yes,
 * kills them and marks the matching workspace rows killed. Dry run by default: killing a sandbox
 * discards any workspace files that were not exported as artifacts.
 */
import { inArray } from 'drizzle-orm';
import { getEnv } from '@superagent/config';
import { closeDb, getDb, schema } from '@superagent/db';
import { APP_METADATA, realSandboxApi } from '@superagent/execution';

const env = getEnv();
if (!env.E2B_API_KEY) {
  console.log('E2B_API_KEY not configured; nothing to clean up.');
  process.exit(0);
}
const apply = process.argv.includes('--yes');
const api = realSandboxApi(env.E2B_API_KEY);
const boxes = await api.listByMetadata({ app: APP_METADATA });

for (const b of boxes)
  console.log(
    `${b.state.padEnd(8)} ${b.sandboxId}  kind=${b.metadata.kind ?? '?'} workspace=${b.metadata.workspaceId ?? '?'}`,
  );
if (!boxes.length) console.log('No app sandboxes are running or paused.');
else if (!apply)
  console.log(`\n${boxes.length} sandbox(es). Re-run with --yes to kill them (unexported workspace files are lost).`);
else {
  let killed = 0;
  for (const b of boxes) if (await api.kill(b.sandboxId).catch(() => false)) killed++;
  const db = getDb();
  await db
    .update(schema.workspaces)
    .set({ state: 'killed', sandboxId: null })
    .where(
      inArray(
        schema.workspaces.sandboxId,
        boxes.map((b) => b.sandboxId),
      ),
    );
  console.log(`\nKilled ${killed}/${boxes.length} sandbox(es); workspace rows marked killed.`);
}
await closeDb();
