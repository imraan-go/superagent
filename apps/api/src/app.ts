import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { ZodError } from 'zod';
import { SetupRequiredError, capabilityStatus, type AppEnv } from '@superagent/config';
import {
  ApprovalDecisionRequest,
  BudgetSettingsRequest,
  ConnectRequest,
  CreateScheduleRequest,
  CreateTaskRequest,
  MemoryUpsertRequest,
} from '@superagent/contracts';
import {
  ApprovalError,
  BudgetExceededError,
  ConflictError,
  NotFoundError,
  composioUserIdFor,
  createMemory,
  createPendingConnection,
  createTaskWithOutbox,
  decideIntent,
  deleteMemory,
  enqueueOutbox,
  getArtifactForOwner,
  getBudgetLimits,
  getConnectionForOwner,
  getSettings,
  getTaskForOwner,
  listArtifacts,
  listConnections,
  listEvents,
  listMemories,
  listSchedules,
  listTasksForOwner,
  appendChatMessage,
  createScheduleWithOutbox,
  transitionSchedule,
  type ScheduleTransition,
  markArtifactDeleted,
  schema,
  updateConnection,
  updateMemory,
  upsertSettings,
  usageSummary,
  type Db,
} from '@superagent/db';
import { nanosToUsd, redact, usdToNanos, type Logger } from '@superagent/observability';
import type { ArtifactStore } from '@superagent/storage';
import type { Toolkit, VerifiedConnection } from '@superagent/connectors';
import type { Auth } from './auth';
import { registerChatRoutes } from './routes/chats';
import { registerSettingsRoutes } from './routes/settings';
import { registerUsageRoutes } from './routes/usage';
import { registerSystemRoutes } from './routes/system';
import { registerAppRoutes } from './routes/apps';
import { budgetDefaultsFor } from './budget';

export interface ConnectionsPort {
  initiate(composioUserId: string, toolkit: Toolkit, callbackUrl: string): Promise<{ redirectUrl: string; connectedAccountId: string }>;
  verify(composioUserId: string, toolkit: Toolkit, connectedAccountId: string): Promise<VerifiedConnection>;
  disconnect(connectedAccountId: string): Promise<void>;
}

export interface ApiDeps {
  db: Db;
  env: AppEnv;
  auth: Auth;
  log: Logger;
  store: () => ArtifactStore;
  connections: () => ConnectionsPort;
}

type User = { id: string; email: string; name: string };
type Env = { Variables: { user: User } };
export type AppEnvVars = Env;

export interface RouteHelpers {
  uid: (c: Context<Env>) => string;
  body: <T>(c: Context<Env>, schemaParse: { parse: (v: unknown) => T }) => Promise<T>;
  taskLimiter: RateLimiter;
}

const TERMINAL = ['completed', 'failed', 'cancelled'];

export class RateLimiter {
  private hits = new Map<string, { n: number; reset: number }>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}
  take(key: string): boolean {
    const now = Date.now();
    const h = this.hits.get(key);
    if (!h || h.reset < now) {
      this.hits.set(key, { n: 1, reset: now + this.windowMs });
      return true;
    }
    h.n += 1;
    return h.n <= this.max;
  }
}

function allowedOrigins(env: AppEnv): Set<string> {
  const s = new Set([env.WEB_ORIGIN]);
  if (env.APP_ENV !== 'production') {
    const u = new URL(env.WEB_ORIGIN);
    if (u.hostname === 'localhost') s.add(`${u.protocol}//127.0.0.1:${u.port}`);
    if (u.hostname === '127.0.0.1') s.add(`${u.protocol}//localhost:${u.port}`);
  }
  return s;
}

function intentPreview(i: typeof schema.actionIntents.$inferSelect, conn?: typeof schema.connectedAccounts.$inferSelect) {
  return {
    id: i.id,
    taskId: i.taskId,
    tool: i.toolSlug,
    toolVersion: i.toolVersion,
    account: conn ? { id: conn.id, toolkit: conn.toolkit, label: conn.accountLabel ?? conn.toolkit } : null,
    destination: i.destination,
    args: i.args,
    attachments: i.attachments,
    argsHash: i.argsHash,
    nonce: i.nonce,
    status: i.status,
    expiresAt: i.expiresAt.toISOString(),
    createdAt: i.createdAt.toISOString(),
  };
}

export function createApp(d: ApiDeps) {
  const app = new Hono<Env>();
  const origins = allowedOrigins(d.env);
  const taskLimiter = new RateLimiter(20, 60_000);
  const connectLimiter = new RateLimiter(10, 60_000);

  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Frame-Options', 'DENY');
    // Event streams must reach the browser unbuffered: `no-transform` stops the web origin's
    // compression (Next.js gzips proxied responses otherwise and holds SSE frames back).
    if (c.res.headers.get('Content-Type')?.startsWith('text/event-stream')) {
      c.header('Cache-Control', 'no-cache, no-transform');
      c.header('X-Accel-Buffering', 'no');
    } else c.header('Cache-Control', c.res.headers.get('Cache-Control') ?? 'no-store');
  });

  app.onError((err, c) => {
    if (err instanceof NotFoundError) return c.json({ error: 'not_found', message: err.message }, 404);
    if (err instanceof ApprovalError) return c.json({ error: err.code, message: err.message }, 409);
    if (err instanceof ConflictError) return c.json({ error: 'conflict', message: err.message }, 409);
    if (err instanceof BudgetExceededError) return c.json({ error: 'budget', message: err.message }, 402);
    if (err instanceof ZodError) return c.json({ error: 'invalid_request', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }, 400);
    if (err instanceof SetupRequiredError) return c.json({ error: 'setup_required', capability: err.capability, missing: err.missing }, 503);
    d.log.error('api.error', { path: c.req.path, error: err instanceof Error ? err.message : String(err) });
    return c.json({ error: 'internal' }, 500);
  });

  app.get('/api/health', (c) => c.json({ ok: true }));

  app.on(['GET', 'POST'], '/api/auth/*', (c) => d.auth.handler(c.req.raw));

  // CSRF defence in depth (cookies are SameSite=Lax): state-changing requests must come from the web origin.
  app.use('/api/*', async (c, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      const origin = c.req.header('origin');
      if (!origin || !origins.has(origin)) return c.json({ error: 'forbidden_origin' }, 403);
    }
    await next();
  });

  app.use('/api/*', async (c, next) => {
    const s = await d.auth.api.getSession({ headers: c.req.raw.headers });
    if (!s?.user) return c.json({ error: 'unauthenticated' }, 401);
    c.set('user', { id: s.user.id, email: s.user.email, name: s.user.name });
    await next();
  });

  const uid = (c: Context<Env>) => c.get('user').id;
  const body = async <T>(c: Context<Env>, schemaParse: { parse: (v: unknown) => T }) => schemaParse.parse(await c.req.json().catch(() => ({})));
  const helpers: RouteHelpers = { uid, body, taskLimiter };

  /* ---------- session / setup ---------- */
  app.get('/api/me', (c) => c.json({ user: c.get('user') }));
  app.get('/api/setup/status', (c) => {
    const s = capabilityStatus(d.env);
    return c.json({ capabilities: Object.fromEntries(Object.entries(s).map(([k, v]) => [k, { configured: v.configured, missing: v.missing }])), temporalMode: d.env.TEMPORAL_MODE });
  });

  /* ---------- tasks ---------- */
  app.post('/api/tasks', async (c) => {
    if (!taskLimiter.take(uid(c))) return c.json({ error: 'rate_limited' }, 429);
    const req = await body(c, CreateTaskRequest);
    const { task, created } = await createTaskWithOutbox(d.db, { ownerId: uid(c), prompt: req.prompt, title: req.title, allowedDomains: req.allowedDomains, idempotencyKey: req.idempotencyKey, timezone: req.timezone, retentionDays: d.env.TASK_RETENTION_DAYS });
    return c.json({ task, created }, created ? 201 : 200);
  });

  app.get('/api/tasks', async (c) => c.json({ tasks: await listTasksForOwner(d.db, uid(c)) }));

  app.get('/api/tasks/:id', async (c) => {
    const task = await getTaskForOwner(d.db, uid(c), c.req.param('id'));
    const [events, artifacts, intents] = await Promise.all([
      listEvents(d.db, uid(c), task.id),
      listArtifacts(d.db, uid(c), task.id),
      d.db.select().from(schema.actionIntents).where(and(eq(schema.actionIntents.ownerId, uid(c)), eq(schema.actionIntents.taskId, task.id))).orderBy(asc(schema.actionIntents.createdAt)),
    ]);
    const conns = await listConnections(d.db, uid(c));
    return c.json({ task, events, artifacts, intents: intents.map((i) => intentPreview(i, conns.find((x) => x.id === i.connectedAccountId))) });
  });

  app.get('/api/tasks/:id/stream', async (c) => {
    const ownerId = uid(c);
    const task = await getTaskForOwner(d.db, ownerId, c.req.param('id'));
    let after = Number(c.req.header('last-event-id') ?? c.req.query('after') ?? 0) || 0;
    return streamSSE(c, async (stream) => {
      const started = Date.now();
      let aborted = false;
      stream.onAbort(() => {
        aborted = true;
      });
      while (!aborted && Date.now() - started < 10 * 60_000) {
        const events = await listEvents(d.db, ownerId, task.id, after);
        for (const e of events) {
          after = e.id;
          await stream.writeSSE({ id: String(e.id), event: 'task', data: JSON.stringify({ id: e.id, type: e.type, data: e.data, createdAt: e.createdAt }) });
        }
        const cur = await getTaskForOwner(d.db, ownerId, task.id);
        await stream.writeSSE({ event: 'status', data: JSON.stringify({ status: cur.status }) });
        if (TERMINAL.includes(cur.status) && events.length === 0) break;
        await stream.sleep(1000);
      }
    });
  });

  app.post('/api/tasks/:id/cancel', async (c) => {
    const task = await getTaskForOwner(d.db, uid(c), c.req.param('id'));
    if (TERMINAL.includes(task.status)) return c.json({ ok: true, status: task.status });
    await enqueueOutbox(d.db, { ownerId: uid(c), kind: 'cancel_task', refId: task.id, payload: { taskId: task.id } });
    return c.json({ ok: true, status: 'cancel_requested' }, 202);
  });

  app.delete('/api/tasks/:id', async (c) => {
    const task = await getTaskForOwner(d.db, uid(c), c.req.param('id'));
    if (!TERMINAL.includes(task.status)) throw new ConflictError('cancel the task before deleting it');
    const arts = await d.db.select().from(schema.artifacts).where(and(eq(schema.artifacts.ownerId, uid(c)), eq(schema.artifacts.taskId, task.id)));
    for (const a of arts) {
      if (!a.deletedAt) await d.store().delete(a.objectKey);
    }
    await d.db.delete(schema.artifacts).where(and(eq(schema.artifacts.ownerId, uid(c)), eq(schema.artifacts.taskId, task.id)));
    await d.db.delete(schema.tasks).where(and(eq(schema.tasks.id, task.id), eq(schema.tasks.ownerId, uid(c))));
    return c.json({ ok: true, residual: ['Temporal workflow history for this task is kept until the namespace retention period ends.'] });
  });

  /* ---------- approvals ---------- */
  app.get('/api/approvals', async (c) => {
    const rows = await d.db
      .select()
      .from(schema.actionIntents)
      .where(and(eq(schema.actionIntents.ownerId, uid(c)), eq(schema.actionIntents.status, 'pending_approval')))
      .orderBy(desc(schema.actionIntents.createdAt));
    const conns = await listConnections(d.db, uid(c));
    return c.json({ approvals: rows.filter((r) => r.expiresAt.getTime() > Date.now()).map((r) => intentPreview(r, conns.find((x) => x.id === r.connectedAccountId))) });
  });

  app.post('/api/approvals/:id', async (c) => {
    const req = await body(c, ApprovalDecisionRequest);
    const r = await decideIntent(d.db, uid(c), c.req.param('id'), req);
    return c.json({ ok: true, ...r });
  });

  /* ---------- schedules ---------- */
  app.get('/api/schedules', async (c) => c.json({ schedules: await listSchedules(d.db, uid(c)) }));

  app.post('/api/schedules', async (c) => {
    const req = await body(c, CreateScheduleRequest);
    const row = await createScheduleWithOutbox(d.db, { ownerId: uid(c), ...req });
    return c.json({ schedule: row }, 201);
  });

  // Changes made outside the chat leave a note in the routine's chat, so its history stays true.
  const scheduleTransition = (t: ScheduleTransition) => async (c: Context<Env>) => {
    const { schedule, state } = await transitionSchedule(d.db, uid(c), c.req.param('id')!, t);
    if (schedule.chatId) {
      const verb = { pause: 'paused', resume: 'resumed', delete: 'deleted' }[t];
      await appendChatMessage(d.db, { ownerId: uid(c), chatId: schedule.chatId, role: 'system', content: [{ type: 'text', text: `Routine “${schedule.name}” ${verb} from Settings.` }] }).catch(() => undefined);
    }
    return c.json({ ok: true, state });
  };
  app.post('/api/schedules/:id/pause', scheduleTransition('pause'));
  app.post('/api/schedules/:id/resume', scheduleTransition('resume'));
  app.delete('/api/schedules/:id', scheduleTransition('delete'));

  /* ---------- connections (Composio) ---------- */
  const publicConn = (x: typeof schema.connectedAccounts.$inferSelect) => ({
    id: x.id,
    toolkit: x.toolkit,
    status: x.status,
    label: x.accountLabel,
    lastVerifiedAt: x.lastVerifiedAt?.toISOString() ?? null,
    createdAt: x.createdAt.toISOString(),
  });

  app.get('/api/connections', async (c) => c.json({ connections: (await listConnections(d.db, uid(c))).map(publicConn) }));

  app.post('/api/connections', async (c) => {
    if (!connectLimiter.take(uid(c))) return c.json({ error: 'rate_limited' }, 429);
    const req = await body(c, ConnectRequest);
    const connector = d.connections();
    const row = await createPendingConnection(d.db, uid(c), req.toolkit, null);
    const callbackUrl = `${d.env.WEB_ORIGIN}/api/connections/callback?cid=${row.id}`;
    try {
      const r = await connector.initiate(composioUserIdFor(uid(c)), req.toolkit, callbackUrl);
      await updateConnection(d.db, uid(c), row.id, { composioConnectedAccountId: r.connectedAccountId });
      return c.json({ connectionId: row.id, redirectUrl: r.redirectUrl }, 201);
    } catch (err) {
      await updateConnection(d.db, uid(c), row.id, { status: 'failed' });
      throw err;
    }
  });

  const verifyConnection = async (ownerId: string, id: string) => {
    const conn = await getConnectionForOwner(d.db, ownerId, id);
    if (!conn.composioConnectedAccountId) return conn;
    const v = await d.connections().verify(conn.composioUserId, conn.toolkit as Toolkit, conn.composioConnectedAccountId);
    const toolkitMismatch = v.toolkit !== null && v.toolkit !== conn.toolkit;
    const status = toolkitMismatch ? 'failed' : v.state;
    await updateConnection(d.db, ownerId, conn.id, { status, lastVerifiedAt: new Date(), authConfigId: v.authConfigId ?? conn.authConfigId });
    return { ...conn, status };
  };

  // OAuth return. Query params from the provider are hints only: state comes from Composio for the
  // connection id we stored for THIS authenticated owner.
  app.get('/api/connections/callback', async (c) => {
    const cid = c.req.query('cid') ?? '';
    try {
      const conn = await verifyConnection(uid(c), cid);
      // Back to the app's page in the Connect Apps modal.
      return c.redirect(`${d.env.WEB_ORIGIN}/?app=${encodeURIComponent(conn.toolkit)}&result=${encodeURIComponent(conn.status)}`, 302);
    } catch (err) {
      if (err instanceof NotFoundError) return c.redirect(`${d.env.WEB_ORIGIN}/?result=not_found`, 302);
      throw err;
    }
  });

  app.post('/api/connections/:id/verify', async (c) => {
    const conn = await verifyConnection(uid(c), c.req.param('id'));
    return c.json({ connection: publicConn({ ...(await getConnectionForOwner(d.db, uid(c), conn.id)) }) });
  });

  app.delete('/api/connections/:id', async (c) => {
    const conn = await getConnectionForOwner(d.db, uid(c), c.req.param('id'));
    if (conn.composioConnectedAccountId && conn.status !== 'disconnected') await d.connections().disconnect(conn.composioConnectedAccountId);
    await updateConnection(d.db, uid(c), conn.id, { status: 'disconnected' });
    return c.json({ ok: true });
  });

  /* ---------- memory ---------- */
  app.get('/api/memories', async (c) => c.json({ memories: await listMemories(d.db, uid(c)) }));
  app.post('/api/memories', async (c) => {
    const req = await body(c, MemoryUpsertRequest);
    return c.json({ memory: await createMemory(d.db, uid(c), req.content, { source: 'user' }) }, 201);
  });
  app.patch('/api/memories/:id', async (c) => {
    const req = await body(c, MemoryUpsertRequest);
    return c.json({ memory: await updateMemory(d.db, uid(c), c.req.param('id'), req.content) });
  });
  app.delete('/api/memories/:id', async (c) => {
    await deleteMemory(d.db, uid(c), c.req.param('id'));
    return c.json({ ok: true });
  });

  /* ---------- artifacts ---------- */
  app.get('/api/artifacts', async (c) => c.json({ artifacts: await listArtifacts(d.db, uid(c), c.req.query('taskId') || undefined) }));

  app.get('/api/artifacts/:id/download', async (c) => {
    const a = await getArtifactForOwner(d.db, uid(c), c.req.param('id'));
    const obj = await d.store().get(a.objectKey);
    const inline = c.req.query('inline') === '1' && (a.contentType === 'image/png' || a.contentType === 'image/jpeg');
    const headers = new Headers({
      'Content-Type': a.contentType,
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${a.name.replace(/"/g, '')}"`,
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
      'X-Checksum-Sha256': a.sha256,
    });
    if (obj.contentLength) headers.set('Content-Length', String(obj.contentLength));
    const web = new ReadableStream({
      async start(controller) {
        for await (const chunk of obj.stream) controller.enqueue(chunk as Uint8Array);
        controller.close();
      },
    });
    return new Response(web, { status: 200, headers });
  });

  app.delete('/api/artifacts/:id', async (c) => {
    const a = await getArtifactForOwner(d.db, uid(c), c.req.param('id'));
    await d.store().delete(a.objectKey);
    await markArtifactDeleted(d.db, uid(c), a.id);
    return c.json({ ok: true });
  });

  /* ---------- usage + budget ---------- */
  const defaults = () => budgetDefaultsFor(d.env);
  app.get('/api/usage', async (c) => {
    const limits = await getBudgetLimits(d.db, uid(c), defaults());
    const summary = await usageSummary(d.db, uid(c));
    return c.json({
      ...summary,
      limits: { perRunUsd: limits.perRunNanos !== null ? nanosToUsd(limits.perRunNanos) : null, monthlyUsd: limits.monthlyNanos !== null ? nanosToUsd(limits.monthlyNanos) : null },
      note: 'Costs are measured (Gateway-reported), estimated (from a configured rate) or unknown. These are not a vendor invoice.',
    });
  });

  app.put('/api/settings/budget', async (c) => {
    const req = await body(c, BudgetSettingsRequest);
    await upsertSettings(d.db, uid(c), { maxCostPerRunNanos: usdToNanos(req.maxCostPerRunUsd), monthlyLimitNanos: usdToNanos(req.monthlyLimitUsd) });
    const limits = await getBudgetLimits(d.db, uid(c), defaults());
    return c.json({ effective: { perRunUsd: limits.perRunNanos !== null ? nanosToUsd(limits.perRunNanos) : null, monthlyUsd: limits.monthlyNanos !== null ? nanosToUsd(limits.monthlyNanos) : null } });
  });

  app.get('/api/settings', async (c) => {
    const s = await getSettings(d.db, uid(c));
    return c.json({
      maxCostPerRunUsd: s?.maxCostPerRunNanos != null ? nanosToUsd(s.maxCostPerRunNanos) : null,
      monthlyLimitUsd: s?.monthlyLimitNanos != null ? nanosToUsd(s.monthlyLimitNanos) : null,
      retention: { taskDays: d.env.TASK_RETENTION_DAYS, operationalLogDays: d.env.OPERATIONAL_LOG_RETENTION_DAYS, approvalExpiryHours: d.env.APPROVAL_EXPIRY_HOURS },
    });
  });

  registerChatRoutes(app, d, helpers);
  registerSettingsRoutes(app, d, helpers);
  registerUsageRoutes(app, d, helpers);
  registerSystemRoutes(app, d, helpers);
  registerAppRoutes(app, d, helpers);

  /* ---------- export + deletion ---------- */
  app.get('/api/export', async (c) => {
    const ownerId = uid(c);
    const tasks = await d.db.select().from(schema.tasks).where(eq(schema.tasks.ownerId, ownerId));
    const ids = tasks.map((t) => t.id);
    const [messages, events, memories, connections, artifacts, schedules] = await Promise.all([
      ids.length ? d.db.select().from(schema.taskMessages).where(and(eq(schema.taskMessages.ownerId, ownerId), inArray(schema.taskMessages.taskId, ids))) : [],
      ids.length ? d.db.select().from(schema.taskEvents).where(and(eq(schema.taskEvents.ownerId, ownerId), inArray(schema.taskEvents.taskId, ids))) : [],
      listMemories(d.db, ownerId),
      listConnections(d.db, ownerId),
      d.db.select().from(schema.artifacts).where(and(eq(schema.artifacts.ownerId, ownerId), isNull(schema.artifacts.deletedAt))),
      listSchedules(d.db, ownerId),
    ]);
    c.header('Content-Disposition', 'attachment; filename="superagent-export.json"');
    return c.json(
      redact({
        exportedAt: new Date().toISOString(),
        user: c.get('user'),
        tasks,
        messages,
        events,
        memories,
        schedules,
        connections: connections.map(publicConn),
        artifacts: artifacts.map((a) => ({ id: a.id, taskId: a.taskId, name: a.name, contentType: a.contentType, sizeBytes: a.sizeBytes, sha256: a.sha256, createdAt: a.createdAt })),
      }) as Record<string, unknown>,
    );
  });

  app.delete('/api/me/data', async (c) => {
    const ownerId = uid(c);
    const running = await d.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.ownerId, ownerId), inArray(schema.tasks.status, ['queued', 'running', 'waiting_approval'])));
    if ((running[0]?.n ?? 0) > 0) throw new ConflictError('cancel running tasks before deleting your data');
    const residual: string[] = [
      'Temporal workflow histories remain until the namespace retention period ends (local dev server: until .local/temporal.db is reset).',
      'Provider-side logs (Vercel AI Gateway, Composio, E2B) follow those providers’ retention policies.',
      'Your cloud workspace sandboxes are destroyed by the worker’s orphan sweep within about 15 minutes.',
    ];
    for (const conn of await listConnections(d.db, ownerId)) {
      if (conn.composioConnectedAccountId && conn.status !== 'disconnected') {
        try {
          await d.connections().disconnect(conn.composioConnectedAccountId);
        } catch {
          residual.push(`Could not revoke ${conn.toolkit} connection at Composio; revoke it in your provider account settings.`);
        }
      }
    }
    for (const a of await d.db.select().from(schema.artifacts).where(eq(schema.artifacts.ownerId, ownerId))) {
      if (!a.deletedAt) await d.store().delete(a.objectKey).catch(() => residual.push(`artifact ${a.id} object could not be deleted`));
    }
    for (const s of await listSchedules(d.db, ownerId)) {
      await d.db.update(schema.schedules).set({ state: 'deleted' }).where(eq(schema.schedules.id, s.id));
      await enqueueOutbox(d.db, { ownerId, kind: 'delete_schedule', refId: s.id, payload: { scheduleId: s.id } });
    }
    await d.db.transaction(async (tx) => {
      await tx.delete(schema.artifacts).where(eq(schema.artifacts.ownerId, ownerId));
      await tx.delete(schema.tasks).where(eq(schema.tasks.ownerId, ownerId));
      await tx.delete(schema.memories).where(eq(schema.memories.ownerId, ownerId));
      await tx.delete(schema.connectedAccounts).where(eq(schema.connectedAccounts.ownerId, ownerId));
      await tx.delete(schema.workspaces).where(eq(schema.workspaces.ownerId, ownerId));
      await tx.insert(schema.deletionRequests).values({ ownerId, scope: 'all', status: 'completed', residual, completedAt: new Date() });
    });
    return c.json({ ok: true, residual });
  });

  return app;
}
