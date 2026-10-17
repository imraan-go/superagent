import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { getBudgetLimits, getPreference, monthStartUtc, schema, type Db } from '@superagent/db';
import { nanosToUsd } from '@superagent/observability';
import type { ApiDeps, AppEnvVars, RouteHelpers } from '../app';
import { budgetDefaultsFor } from '../budget';

/**
 * Usage readouts from usage_entries (Gateway-reported or estimated costs) and tool_calls. Costs
 * are app-side records, not a vendor invoice; `unknown` costs count as zero here.
 */

interface Totals {
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
  costUsd: number;
  calls: number;
  toolCalls: number;
}

const ZERO: Totals = { tokensIn: 0, tokensOut: 0, tokensCached: 0, costUsd: 0, calls: 0, toolCalls: 0 };

function usd(nanos: unknown): number {
  if (nanos === null || nanos === undefined) return 0;
  return Number(nanosToUsd(BigInt(String(nanos))));
}

async function totals(
  db: Db,
  ownerId: string,
  where: { since?: Date; taskIds?: ReturnType<typeof sql> | null; taskId?: string },
): Promise<Totals> {
  const u = schema.usageEntries;
  const conds = [eq(u.ownerId, ownerId)];
  if (where.since) conds.push(gte(u.createdAt, where.since));
  if (where.taskId) conds.push(eq(u.taskId, where.taskId));
  if (where.taskIds) conds.push(sql`${u.taskId} in (${where.taskIds})`);
  const [row] = await db
    .select({
      tokensIn: sql<number>`coalesce(sum(${u.inputTokens}),0)::int`,
      tokensOut: sql<number>`coalesce(sum(${u.outputTokens}),0)::int`,
      tokensCached: sql<number>`coalesce(sum(${u.cacheReadTokens}),0)::int`,
      cost: sql<string>`coalesce(sum(${u.costNanos}),0)::text`,
      calls: sql<number>`count(*) filter (where ${u.kind} = 'model')::int`,
      toolCalls: sql<number>`count(*) filter (where ${u.kind} <> 'model')::int`,
    })
    .from(u)
    .where(and(...conds));
  return row
    ? {
        tokensIn: row.tokensIn,
        tokensOut: row.tokensOut,
        tokensCached: row.tokensCached,
        costUsd: usd(row.cost),
        calls: row.calls,
        toolCalls: row.toolCalls,
      }
    : { ...ZERO };
}

export function registerUsageRoutes(app: Hono<AppEnvVars>, d: ApiDeps, h: RouteHelpers) {
  const { uid } = h;

  const summary = async (ownerId: string, chatId?: string, runId?: string) => {
    const dayStart = new Date(new Date().toISOString().slice(0, 10));
    const chatTasks = chatId ? sql`select id from tasks where owner_id = ${ownerId} and chat_id = ${chatId}` : null;
    const [today, month, chat, run] = await Promise.all([
      totals(d.db, ownerId, { since: dayStart }),
      totals(d.db, ownerId, { since: monthStartUtc() }),
      chatTasks ? totals(d.db, ownerId, { taskIds: chatTasks }) : Promise.resolve(null),
      runId ? totals(d.db, ownerId, { taskId: runId }) : Promise.resolve(null),
    ]);
    const tc = schema.toolCalls;
    const [stats] = await d.db
      .select({
        toolCalls: sql<number>`count(*)::int`,
        toolOk: sql<number>`count(*) filter (where ${tc.status} = 'done')::int`,
        toolFailed: sql<number>`count(*) filter (where ${tc.status} in ('failed','denied'))::int`,
      })
      .from(tc)
      .where(and(eq(tc.ownerId, ownerId), gte(tc.createdAt, dayStart)));
    const limits = await getBudgetLimits(d.db, ownerId, budgetDefaultsFor(d.env));
    const warnAtPct = Number((await getPreference(d.db, ownerId, 'usage')).warnAtPct ?? 80) || 80;
    const limitUsd = limits.monthlyNanos !== null ? usd(limits.monthlyNanos) : 0;
    const pct = limitUsd > 0 ? (month.costUsd / limitUsd) * 100 : 0;
    return {
      day: dayStart.toISOString().slice(0, 10),
      today,
      month,
      chat,
      run,
      stats: {
        toolCalls: stats?.toolCalls ?? 0,
        toolOk: stats?.toolOk ?? 0,
        toolFailed: stats?.toolFailed ?? 0,
        avgToolMs: null,
      },
      budget:
        limitUsd > 0
          ? {
              limitUsd,
              period: 'month',
              warnAtPct,
              pct,
              state: month.costUsd > limitUsd ? 'over' : pct >= warnAtPct ? 'warn' : 'ok',
            }
          : null,
    };
  };

  app.get('/api/usage/live', async (c) => {
    const ownerId = uid(c);
    const chatId = c.req.query('chatId') || undefined;
    const runId = c.req.query('runId') || undefined;
    return streamSSE(c, async (stream) => {
      let aborted = false;
      stream.onAbort(() => {
        aborted = true;
      });
      const started = Date.now();
      let last = '';
      while (!aborted && Date.now() - started < 10 * 60_000) {
        const data = JSON.stringify(await summary(ownerId, chatId, runId));
        if (data !== last) await stream.writeSSE({ event: 'usage', data });
        last = data;
        await stream.sleep(5000);
      }
    });
  });

  const GROUPS = {
    day: sql`to_char(date_trunc('day', ${schema.usageEntries.createdAt}), 'YYYY-MM-DD')`,
    model: sql`coalesce(${schema.usageEntries.model}, ${schema.usageEntries.kind})`,
    kind: sql`${schema.usageEntries.kind}`,
    task: sql`coalesce(${schema.usageEntries.taskId}::text, 'none')`,
  } as const;

  const reportRange = (fromQ?: string, toQ?: string) => {
    const to = toQ ? new Date(toQ) : new Date(Date.now() + 86_400_000);
    const from = fromQ ? new Date(fromQ) : monthStartUtc();
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
    return { from, to };
  };

  app.get('/api/usage/report', async (c) => {
    const ownerId = uid(c);
    const groupBy = (c.req.query('groupBy') ?? 'day') as keyof typeof GROUPS;
    if (!GROUPS[groupBy])
      return c.json({ error: 'invalid_request', message: 'groupBy must be day, model, kind or task' }, 400);
    const range = reportRange(c.req.query('from'), c.req.query('to'));
    if (!range) return c.json({ error: 'invalid_request', message: 'bad date range' }, 400);
    const u = schema.usageEntries;
    const key = GROUPS[groupBy];
    const rows = await d.db
      .select({
        key: sql<string>`${key}`,
        events: sql<number>`count(*)::int`,
        tokensIn: sql<number>`coalesce(sum(${u.inputTokens}),0)::int`,
        tokensOut: sql<number>`coalesce(sum(${u.outputTokens}),0)::int`,
        tokensCached: sql<number>`coalesce(sum(${u.cacheReadTokens}),0)::int`,
        cost: sql<string>`coalesce(sum(${u.costNanos}),0)::text`,
      })
      .from(u)
      .where(and(eq(u.ownerId, ownerId), gte(u.createdAt, range.from), lt(u.createdAt, range.to)))
      .groupBy(key)
      .orderBy(sql`1 desc`);
    let titles = new Map<string, string>();
    if (groupBy === 'task' && rows.length) {
      const t = await d.db
        .select({ id: schema.tasks.id, title: schema.tasks.title })
        .from(schema.tasks)
        .where(eq(schema.tasks.ownerId, ownerId));
      titles = new Map(t.map((x) => [x.id, x.title]));
    }
    const out = rows.map((r) => ({
      key: r.key,
      label: titles.get(r.key) ?? r.key,
      events: r.events,
      tokensIn: r.tokensIn,
      tokensOut: r.tokensOut,
      tokensCached: r.tokensCached,
      costUsd: usd(r.cost),
    }));
    const tot = out.reduce(
      (a, r) => ({
        events: a.events + r.events,
        tokensIn: a.tokensIn + r.tokensIn,
        tokensOut: a.tokensOut + r.tokensOut,
        tokensCached: a.tokensCached + r.tokensCached,
        costUsd: a.costUsd + r.costUsd,
      }),
      { events: 0, tokensIn: 0, tokensOut: 0, tokensCached: 0, costUsd: 0 },
    );
    const today = await totals(d.db, ownerId, { since: new Date(new Date().toISOString().slice(0, 10)) });
    return c.json({
      groupBy,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      rows: out,
      totals: tot,
      todayUsd: today.costUsd,
      note: 'Costs are measured (Gateway-reported), estimated or unknown (counted as 0). Not a vendor invoice.',
    });
  });

  app.get('/api/usage/export', async (c) => {
    const ownerId = uid(c);
    const range = reportRange(c.req.query('from'), c.req.query('to'));
    if (!range) return c.json({ error: 'invalid_request', message: 'bad date range' }, 400);
    const u = schema.usageEntries;
    const rows = await d.db
      .select()
      .from(u)
      .where(and(eq(u.ownerId, ownerId), gte(u.createdAt, range.from), lt(u.createdAt, range.to)))
      .orderBy(u.createdAt);
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      // Neutralise spreadsheet formulas and quote every field.
      return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
    };
    const header = [
      'created_at',
      'kind',
      'provider',
      'model',
      'task_id',
      'input_tokens',
      'output_tokens',
      'cache_read_tokens',
      'quantity',
      'cost_usd',
      'cost_status',
    ];
    const lines = rows.map((r) =>
      [
        r.createdAt.toISOString(),
        r.kind,
        r.provider,
        r.model,
        r.taskId,
        r.inputTokens,
        r.outputTokens,
        r.cacheReadTokens,
        r.quantity,
        r.costNanos !== null ? nanosToUsd(r.costNanos) : '',
        r.costStatus,
      ]
        .map(esc)
        .join(','),
    );
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', 'attachment; filename="superagent-usage.csv"');
    return c.body([header.join(','), ...lines].join('\n'));
  });
}
