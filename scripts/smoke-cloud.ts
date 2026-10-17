/**
 * `pnpm smoke:cloud [--stage=m1|m2|m3|m4|m5|all]` — live end-to-end smoke tests through the running
 * API + worker + Temporal, against REAL cloud services. Bounded by LIVE_SMOKE_MAX_COST (cumulative
 * across smoke runs, from the usage ledger) and MAX_COST_PER_RUN (per task). Never prints secrets.
 * Writes a JSON report to .local/smoke/.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq, like, sql } from 'drizzle-orm';
import { REPO_ROOT, capabilityStatus, getEnv } from '@superagent/config';
import { closeDb, getDb, schema } from '@superagent/db';
import { nanosToUsd, usdToNanos } from '@superagent/observability';
import { describeTemporalSchedule, getTemporalClient } from '@superagent/temporal';

const env = getEnv();
const API = `http://127.0.0.1:${env.API_PORT}`;
const stageArg = process.argv.find((a) => a.startsWith('--stage='))?.split('=')[1] ?? 'm1';
const db = getDb();
let cookie = '';

async function api<T>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { origin: env.WEB_ORIGIN, cookie, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  const set = res.headers.getSetCookie();
  if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : {}) as T };
}

async function smokeSpentNanos(): Promise<bigint> {
  const [r] = await db
    .select({ total: sql<string>`coalesce(sum(${schema.usageEntries.costNanos}), 0)` })
    .from(schema.usageEntries)
    .innerJoin(schema.tasks, eq(schema.tasks.id, schema.usageEntries.taskId))
    .where(like(schema.tasks.title, '[smoke]%'));
  return BigInt(r?.total ?? '0');
}

interface StageResult {
  stage: string;
  taskId?: string;
  workflowId?: string;
  status: string;
  events: string[];
  costUsd: string;
  generationIds: string[];
  notes: string[];
  durationMs: number;
}

async function runTask(
  stage: string,
  prompt: string,
  allowedDomains: string[] = [],
  timeoutMs = 240_000,
): Promise<StageResult> {
  const started = Date.now();
  const created = await api<{ task: { id: string; workflowId: string } }>('POST', '/api/tasks', {
    title: `[smoke] ${stage}`,
    prompt,
    allowedDomains,
    idempotencyKey: `smoke-${stage}-${Date.now()}`,
  });
  if (created.status >= 300)
    throw new Error(`create task failed: HTTP ${created.status} ${JSON.stringify(created.json)}`);
  const { id, workflowId } = created.json.task;
  console.log(`  task ${id} (workflow ${workflowId})`);
  return waitForTask(stage, id, workflowId, started, timeoutMs);
}

async function waitForTask(
  stage: string,
  id: string,
  workflowId: string,
  started: number,
  timeoutMs = 240_000,
): Promise<StageResult> {
  let status = 'queued';
  let events: Array<{ type: string; data: Record<string, unknown> }> = [];
  while (Date.now() - started < timeoutMs) {
    const r = await api<{
      task: { status: string; resultSummary: string | null; error: string | null };
      events: typeof events;
    }>('GET', `/api/tasks/${id}`);
    status = r.json.task.status;
    events = r.json.events;
    if (['completed', 'failed', 'cancelled'].includes(status)) {
      const usage = await db.select().from(schema.usageEntries).where(eq(schema.usageEntries.taskId, id));
      const cost = usage.reduce((a, u) => a + (u.costNanos ?? 0n), 0n);
      const notes = [`result: ${(r.json.task.resultSummary ?? r.json.task.error ?? '').slice(0, 300)}`];
      const unknown = usage.filter((u) => u.costStatus === 'unknown').map((u) => u.kind);
      if (unknown.length) notes.push(`cost unknown for: ${[...new Set(unknown)].join(', ')}`);
      return {
        stage,
        taskId: id,
        workflowId,
        status,
        events: events.map((e) => e.type),
        costUsd: nanosToUsd(cost),
        generationIds: usage.filter((u) => u.kind === 'model').map((u) => u.requestId ?? '?'),
        notes,
        durationMs: Date.now() - started,
      };
    }
    await new Promise((res) => setTimeout(res, 1500));
  }
  return {
    stage,
    taskId: id,
    workflowId,
    status: `timeout (${status})`,
    events: events.map((e) => e.type),
    costUsd: '?',
    generationIds: [],
    notes: ['timed out waiting for completion'],
    durationMs: Date.now() - started,
  };
}

const STAGES: Record<
  string,
  { needs: Array<keyof ReturnType<typeof capabilityStatus>>; run: () => Promise<StageResult> }
> = {
  m1: {
    needs: ['gateway', 'budget'],
    run: () =>
      runTask(
        'm1',
        'Save a memory note that I prefer metric units. Then reply with one short sentence confirming it was saved.',
      ),
  },
  m2: {
    needs: ['gateway', 'budget', 'e2b_code', 'storage'],
    run: () =>
      runTask(
        'm2',
        'In the workspace, use Python to compute the first 15 Fibonacci numbers and write them, one per line, to reports/fib.txt. Read the file back to verify it, then export reports/fib.txt and reply with the artifact name.',
      ),
  },
  m3: {
    needs: ['gateway', 'budget', 'e2b_browser', 'storage'],
    run: () =>
      runTask(
        'm3',
        'Open https://example.com, read the page, take a screenshot, then reply with the page title and one sentence describing the page.',
        ['example.com'],
      ),
  },
  m4: {
    needs: ['gateway', 'budget', 'composio'],
    run: () =>
      runTask(
        'm4',
        'Using my connected GitHub account, get my GitHub username and list up to 5 of my most recently updated repositories. Reply with the username and repo names only.',
      ),
  },
  m5: { needs: ['gateway', 'budget'], run: runScheduleStage },
};

async function poll<T>(what: string, fn: () => Promise<T | undefined>, timeoutMs = 30_000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = await fn();
    if (v !== undefined) return v;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/**
 * M5: a real Temporal Schedule created through the API/outbox, fired once on demand (trigger), runs
 * a read-only scheduled task on the Gateway; then pause/resume/delete are verified in Temporal.
 */
async function runScheduleStage(): Promise<StageResult> {
  const started = Date.now();
  const notes: string[] = [];
  const created = await api<{ schedule: { id: string; temporalScheduleId: string } }>('POST', '/api/schedules', {
    name: '[smoke] m5',
    prompt:
      "Reply with one short sentence stating today's weekday in my timezone if you know it, otherwise say you do not know. Do not use any tools.",
    spec: { kind: 'cron', cron: '0 9 * * 0' },
    timezone: 'America/Toronto',
  });
  if (created.status !== 201)
    throw new Error(`create schedule failed: HTTP ${created.status} ${JSON.stringify(created.json)}`);
  const { id, temporalScheduleId } = created.json.schedule;
  console.log(`  schedule ${id} (temporal ${temporalScheduleId})`);
  const client = await getTemporalClient();
  try {
    const desc = await poll(
      'temporal schedule',
      async () => (await describeTemporalSchedule(client, temporalScheduleId)) ?? undefined,
    );
    notes.push(`next runs (UTC): ${desc.nextActionTimes.slice(0, 3).join(', ')}`);
    await client.schedule.getHandle(temporalScheduleId).trigger();
    const task = await poll(
      'scheduled task',
      async () => (await db.select().from(schema.tasks).where(eq(schema.tasks.scheduleId, id)).limit(1))[0],
      60_000,
    );
    console.log(`  scheduled task ${task.id} (read-only ${task.readOnly})`);
    if (!task.readOnly) throw new Error('scheduled task is not read-only');
    const r = await waitForTask('m5', task.id, task.workflowId, started);

    await api('POST', `/api/schedules/${id}/pause`);
    await poll('paused in temporal', async () =>
      (await describeTemporalSchedule(client, temporalScheduleId))?.paused ? true : undefined,
    );
    await api('POST', `/api/schedules/${id}/resume`);
    await poll('resumed in temporal', async () =>
      (await describeTemporalSchedule(client, temporalScheduleId))?.paused === false ? true : undefined,
    );
    notes.push('pause and resume reflected in Temporal');
    return { ...r, notes: [...r.notes, ...notes] };
  } finally {
    await api('DELETE', `/api/schedules/${id}`);
    await poll('schedule deleted', async () =>
      (await describeTemporalSchedule(client, temporalScheduleId)) === null ? true : undefined,
    ).then(
      () => console.log('  schedule deleted in Temporal'),
      (e: Error) => console.log(`  WARN ${e.message}`),
    );
  }
}

async function main() {
  if (!env.LIVE_SMOKE_MAX_COST) throw new Error('Set LIVE_SMOKE_MAX_COST in .env before running live smoke tests.');
  const cap = usdToNanos(env.LIVE_SMOKE_MAX_COST);
  const caps = capabilityStatus(env);
  const health = await fetch(`${API}/api/health`).catch(() => null);
  if (!health?.ok)
    throw new Error(`API not reachable at ${API}; start it with \`pnpm dev\` (and \`pnpm worker:dev\`).`);
  if (!env.DEV_SEED_EMAIL || !env.DEV_SEED_PASSWORD)
    throw new Error('Dev seed credentials missing; run `pnpm setup:env && pnpm db:seed:dev`.');
  const login = await api('POST', '/api/auth/sign-in/email', {
    email: env.DEV_SEED_EMAIL,
    password: env.DEV_SEED_PASSWORD,
  });
  if (login.status !== 200) throw new Error(`sign-in failed: HTTP ${login.status}`);

  const order = stageArg === 'all' ? Object.keys(STAGES) : stageArg.split(',');
  const results: StageResult[] = [];
  for (const name of order) {
    const st = STAGES[name];
    if (!st) throw new Error(`unknown stage ${name}`);
    const missing = st.needs.filter((n) => !caps[n].configured);
    if (missing.length) {
      console.log(
        `SKIP ${name}: not configured (${missing.map((m) => `${m}: ${caps[m].missing.join('/')}`).join('; ')})`,
      );
      results.push({
        stage: name,
        status: 'skipped',
        events: [],
        costUsd: '0',
        generationIds: [],
        notes: [`missing ${missing.join(', ')}`],
        durationMs: 0,
      });
      continue;
    }
    const spent = await smokeSpentNanos();
    const perRun = env.MAX_COST_PER_RUN ? usdToNanos(env.MAX_COST_PER_RUN) : cap;
    if (spent + perRun > cap) {
      console.log(
        `STOP before ${name}: smoke spend ${nanosToUsd(spent)} + per-run cap ${nanosToUsd(perRun)} would exceed LIVE_SMOKE_MAX_COST ${env.LIVE_SMOKE_MAX_COST} USD`,
      );
      break;
    }
    console.log(`RUN  ${name} (smoke spent so far ${nanosToUsd(spent)} USD of ${env.LIVE_SMOKE_MAX_COST})`);
    const r = await st.run();
    results.push(r);
    console.log(`  ${r.status} in ${r.durationMs}ms, cost ${r.costUsd} USD, events: ${r.events.join(' > ')}`);
    for (const n of r.notes) console.log(`  ${n}`);
  }
  const outDir = join(REPO_ROOT, '.local', 'smoke');
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `smoke-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      { at: new Date().toISOString(), totalSmokeSpendUsd: nanosToUsd(await smokeSpentNanos()), results },
      null,
      2,
    ),
  );
  console.log(`report: ${file}`);
  await closeDb();
  process.exit(results.some((r) => r.status !== 'completed' && r.status !== 'skipped') ? 1 : 0);
}

void and;
main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
