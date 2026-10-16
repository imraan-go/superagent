import { createRequire } from 'node:module';
import { NativeConnection, Runtime, DefaultLogger, Worker } from '@temporalio/worker';
import { eq } from 'drizzle-orm';
import { capabilityStatus, getEnv, requireKeys } from '@superagent/config';
import { createActivities, createRealDeps } from '@superagent/activities';
import { closeDb, getDb, schema } from '@superagent/db';
import { realSandboxApi, reconcileOrphanSandboxes } from '@superagent/execution';
import { createLogger } from '@superagent/observability';
import { ensureRetentionSchedule, getTemporalClient, temporalSettings } from '@superagent/temporal';
import { drainOutbox, reconcileProjections } from './reconciler';

const log = createLogger('worker');
const require = createRequire(import.meta.url);

async function main() {
  const env = getEnv();
  requireKeys('database', ['DATABASE_URL'], 'Run `pnpm setup:env`, `pnpm infra:up` and `pnpm db:migrate`.');
  const s = temporalSettings(env);
  Runtime.install({ logger: new DefaultLogger('WARN') });

  const connection = await NativeConnection.connect({
    address: s.address,
    ...(s.tls !== undefined ? { tls: s.tls } : {}),
    ...(s.apiKey ? { apiKey: s.apiKey } : {}),
  });
  const deps = createRealDeps();
  const worker = await Worker.create({
    connection,
    namespace: s.namespace,
    taskQueue: s.taskQueue,
    workflowsPath: require.resolve('@superagent/workflows'),
    activities: createActivities(deps),
    maxConcurrentActivityTaskExecutions: 20,
    shutdownGraceTime: '20s',
  });

  const db = getDb();
  const client = await getTemporalClient();
  await ensureRetentionSchedule(client, s.taskQueue).catch((err) => log.warn('retention.schedule_failed', { error: String(err) }));

  const caps = capabilityStatus(env);
  const e2b = caps.e2b_code.configured || caps.e2b_browser.configured ? realSandboxApi(env.E2B_API_KEY!) : undefined;
  const sweepOrphans = async () => {
    if (!e2b) return;
    try {
      const r = await reconcileOrphanSandboxes(e2b, async (id) => {
        const rows = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, id)).limit(1);
        return rows[0] ? { sandboxId: rows[0].sandboxId, state: rows[0].state } : undefined;
      });
      if (r.killed.length) log.info('e2b.orphan_sweep', { checked: r.checked, killed: r.killed.length });
    } catch (err) {
      log.warn('e2b.orphan_sweep_failed', { error: err instanceof Error ? err.message : String(err) });
    }
  };
  await sweepOrphans();

  let stopping = false;
  const outboxLoop = (async () => {
    let lastProjection = 0;
    let lastSweep = Date.now();
    while (!stopping) {
      try {
        const n = await drainOutbox(db, client, s.taskQueue, log, e2b ? deps.workspaces : undefined);
        if (Date.now() - lastProjection > 60_000) {
          lastProjection = Date.now();
          await reconcileProjections(db, client, log);
        }
        if (Date.now() - lastSweep > 15 * 60_000) {
          lastSweep = Date.now();
          await sweepOrphans();
        }
        if (n === 0) await new Promise((r) => setTimeout(r, 1000));
      } catch (err) {
        log.warn('reconciler.error', { error: err instanceof Error ? err.message : String(err) });
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  })();

  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    log.info('worker.shutdown');
    worker.shutdown();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  log.info('worker.started', { mode: s.mode, address: s.address, namespace: s.namespace, taskQueue: s.taskQueue, workerId: deps.workerId });
  await worker.run();
  stopping = true;
  await outboxLoop;
  await connection.close();
  await closeDb();
}

main().catch((err) => {
  log.error('worker.fatal', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
