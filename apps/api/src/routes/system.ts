import type { Context, Hono } from 'hono';
import { and, desc, eq, inArray, like, lt, sql } from 'drizzle-orm';
import { capabilityStatus } from '@superagent/config';
import { ConflictError, NotFoundError, enqueueOutbox, isUuid, listConnections, listPendingQuestions, questionPart, schema } from '@superagent/db';
import type { ApiDeps, AppEnvVars, RouteHelpers } from '../app';

const ACTIVE = ['queued', 'running', 'waiting_approval'];

/**
 * Health and workspace views for the shell: what is configured, whether the worker is draining
 * the outbox, the owner's E2B workspaces, and a recent activity log built from task events.
 */
export function registerSystemRoutes(app: Hono<AppEnvVars>, d: ApiDeps, h: RouteHelpers) {
  const { uid } = h;

  const workspacesOf = (ownerId: string) =>
    d.db.select().from(schema.workspaces).where(eq(schema.workspaces.ownerId, ownerId)).orderBy(desc(schema.workspaces.updatedAt));

  const publicWorkspace = (w: typeof schema.workspaces.$inferSelect) => ({
    id: w.id,
    kind: w.kind,
    scope: w.scope === 'user' ? 'user' : 'task',
    taskId: w.scope === 'user' ? null : w.scope,
    state: w.state,
    sandboxId: w.sandboxId,
    templateId: w.templateId,
    lastActiveAt: w.lastActiveAt?.toISOString() ?? null,
    activeMs: w.activeMsTotal,
    lastError: w.lastError,
    createdAt: w.createdAt.toISOString(),
  });

  app.get('/api/capabilities', async (c) => {
    const ownerId = uid(c);
    const caps = capabilityStatus(d.env);
    // The worker drains the outbox every second; a row waiting > 30s means it is not running.
    const [stale] = await d.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.workflowOutbox)
      .where(and(eq(schema.workflowOutbox.status, 'pending'), lt(schema.workflowOutbox.createdAt, new Date(Date.now() - 30_000))));
    const [ws, conns, questions, approvals, running] = await Promise.all([
      workspacesOf(ownerId),
      listConnections(d.db, ownerId),
      listPendingQuestions(d.db, ownerId),
      d.db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.actionIntents)
        .where(and(eq(schema.actionIntents.ownerId, ownerId), eq(schema.actionIntents.status, 'pending_approval'), sql`${schema.actionIntents.expiresAt} > now()`)),
      d.db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.tasks)
        .where(and(eq(schema.tasks.ownerId, ownerId), inArray(schema.tasks.status, ['queued', 'running']))),
    ]);
    return c.json({
      capabilities: Object.fromEntries(Object.entries(caps).map(([k, v]) => [k, { configured: v.configured, missing: v.missing }])),
      worker: (stale?.n ?? 0) > 0 ? 'stalled' : 'ok',
      running: running[0]?.n ?? 0,
      workspaces: ws.filter((w) => w.state !== 'killed').map(publicWorkspace),
      connectedApps: conns.filter((x) => x.status === 'active').length,
      pending: { questions: questions.length, approvals: approvals[0]?.n ?? 0 },
    });
  });

  /**
   * Everything waiting on the owner: exact-action approvals and agent questions, oldest first.
   * Approvals carry the hash and nonce the decision must echo back (POST /api/approvals/:id).
   */
  app.get('/api/inbox', async (c) => {
    const ownerId = uid(c);
    const i = schema.actionIntents;
    const [intents, questions, conns, running] = await Promise.all([
      d.db
        .select({ intent: i, chatId: schema.tasks.chatId, title: schema.tasks.title })
        .from(i)
        .innerJoin(schema.tasks, eq(schema.tasks.id, i.taskId))
        .where(and(eq(i.ownerId, ownerId), eq(i.status, 'pending_approval'), sql`${i.expiresAt} > now()`)),
      listPendingQuestions(d.db, ownerId),
      listConnections(d.db, ownerId),
      d.db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.tasks)
        .where(and(eq(schema.tasks.ownerId, ownerId), inArray(schema.tasks.status, ['queued', 'running']))),
    ]);
    const items = [
      ...intents.map(({ intent, chatId }) => {
        const conn = conns.find((x) => x.id === intent.connectedAccountId);
        const dest = Object.entries((intent.destination ?? {}) as Record<string, unknown>)
          .filter(([, v]) => v !== null && v !== '')
          .map(([k, v]) => `${k}: ${String(v)}`)
          .join(' · ');
        return {
          id: intent.id,
          source: 'approval' as const,
          kind: 'confirm' as const,
          prompt: `${intent.toolSlug}${conn ? ` on ${conn.accountLabel ?? conn.toolkit}` : ''}${dest ? ` — ${dest}` : ''}`,
          createdAt: intent.createdAt.toISOString(),
          runId: intent.taskId,
          chatId,
          approval: {
            tool: intent.toolSlug,
            account: conn ? { toolkit: conn.toolkit, label: conn.accountLabel ?? conn.toolkit } : null,
            destination: intent.destination,
            args: intent.args,
            argsHash: intent.argsHash,
            nonce: intent.nonce,
            expiresAt: intent.expiresAt.toISOString(),
          },
        };
      }),
      ...questions.map((q) => ({
        id: q.id,
        source: 'question' as const,
        kind: 'ask' as const,
        prompt: q.prompt,
        createdAt: q.createdAt.toISOString(),
        runId: q.taskId,
        chatId: q.chatId,
        question: questionPart(q),
      })),
    ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return c.json({ count: items.length, items, running: running[0]?.n ?? 0 });
  });

  app.get('/api/workspaces', async (c) => c.json({ workspaces: (await workspacesOf(uid(c))).map(publicWorkspace) }));

  /**
   * Pause or destroy a sandbox. The worker owns E2B access and leases, so this queues the request
   * (outbox) rather than calling E2B from the API. Refused while a run could be using it.
   */
  const workspaceOp = (op: 'pause' | 'kill') => async (c: Context<AppEnvVars>) => {
    const ownerId = uid(c);
    const id = c.req.param('id') ?? '';
    if (!isUuid(id)) throw new NotFoundError('workspace');
    const [w] = await d.db.select().from(schema.workspaces).where(and(eq(schema.workspaces.id, id), eq(schema.workspaces.ownerId, ownerId))).limit(1);
    if (!w) throw new NotFoundError('workspace');
    const busy = await d.db
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.ownerId, ownerId), inArray(schema.tasks.status, ['queued', 'running']), ...(w.scope === 'user' ? [] : [eq(schema.tasks.id, w.scope)])))
      .limit(1);
    if (busy.length) throw new ConflictError('a run is using this workspace; stop it first');
    if (op === 'pause' && w.state !== 'running') return c.json({ ok: true, state: w.state });
    await enqueueOutbox(d.db, { ownerId, kind: `workspace_${op}`, refId: w.id, payload: { workspaceId: w.id, kind: w.kind, scope: w.scope } });
    return c.json({ ok: true, state: op === 'pause' ? 'pausing' : 'killing' }, 202);
  };
  app.post('/api/workspaces/:id/pause', workspaceOp('pause'));
  app.post('/api/workspaces/:id/kill', workspaceOp('kill'));

  /** Recent tool activity across the owner's runs (newest first), for the Mission log. */
  app.get('/api/activity', async (c) => {
    const ownerId = uid(c);
    const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? 80) || 80));
    const e = schema.taskEvents;
    const rows = await d.db
      .select({ id: e.id, type: e.type, data: e.data, createdAt: e.createdAt, taskId: e.taskId, chatId: schema.tasks.chatId, title: schema.tasks.title })
      .from(e)
      .innerJoin(schema.tasks, eq(schema.tasks.id, e.taskId))
      .where(and(eq(e.ownerId, ownerId), like(e.type, 'tool.%')))
      .orderBy(desc(e.id))
      .limit(limit);
    return c.json({
      events: rows
        .filter((r) => r.type !== 'tool.started')
        .map((r) => {
          const data = (r.data ?? {}) as Record<string, unknown>;
          return {
            ts: r.createdAt.getTime(),
            tool: String(data.tool ?? 'tool'),
            ok: r.type === 'tool.completed',
            err: r.type === 'tool.completed' ? null : String(data.reason ?? data.summary ?? r.type),
            label: String(data.summary ?? ''),
            taskId: r.taskId,
            chatId: r.chatId,
            run: r.title,
          };
        }),
    });
  });

  /** Browser screenshots taken in a chat's runs, newest first (the Computer tab's view). */
  app.get('/api/chats/:id/screens', async (c) => {
    const ownerId = uid(c);
    const chatId = c.req.param('id');
    if (!isUuid(chatId)) throw new NotFoundError('chat');
    const a = schema.artifacts;
    const rows = await d.db
      .select({ id: a.id, name: a.name, source: a.source, createdAt: a.createdAt, taskId: a.taskId })
      .from(a)
      .innerJoin(schema.tasks, eq(schema.tasks.id, a.taskId))
      .where(and(eq(a.ownerId, ownerId), eq(schema.tasks.chatId, chatId), sql`${a.deletedAt} is null`, sql`${a.source}->>'kind' = 'browser_screenshot'`))
      .orderBy(desc(a.createdAt))
      .limit(30);
    return c.json({
      screens: rows.map((r) => {
        const s = r.source as { url?: string; title?: string };
        return { id: r.id, url: s.url ?? null, title: s.title ?? null, taskId: r.taskId, createdAt: r.createdAt.toISOString(), active: false };
      }),
      active: (await d.db.select({ id: schema.tasks.id }).from(schema.tasks).where(and(eq(schema.tasks.ownerId, ownerId), eq(schema.tasks.chatId, chatId), inArray(schema.tasks.status, ACTIVE))).limit(1)).length > 0,
    });
  });
}
