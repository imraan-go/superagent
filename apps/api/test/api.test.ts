import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EnvSchema } from '@superagent/config';
import { createIntent, getIntentForOwner, insertArtifact, schema, type Db } from '@superagent/db';
import { createLogger } from '@superagent/observability';
import { MemoryArtifactStore } from '@superagent/storage';
import { createApp, type ConnectionsPort } from '../src/app';
import { createAuth } from '../src/auth';
import { createTestDb } from '../../../packages/db/test/helpers';

const ORIGIN = 'http://localhost:3000';
let db: Db;
let close: () => Promise<void>;
let app: ReturnType<typeof createApp>;
const store = new MemoryArtifactStore();
const verifyCalls: string[] = [];
const fakeConnections: ConnectionsPort = {
  initiate: async (_u, toolkit) => ({ redirectUrl: `https://connect.composio.dev/link/${toolkit}`, connectedAccountId: `ca_${toolkit}_1` }),
  verify: async (composioUserId, toolkit, id) => {
    verifyCalls.push(`${composioUserId}:${id}`);
    return { state: 'active', statusReason: null, toolkit, authConfigId: 'ac_test' };
  },
  disconnect: async () => undefined,
};

const cookies: Record<string, string> = {};
const ids: Record<string, string> = {};

async function req(who: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const h: Record<string, string> = { origin: ORIGIN, ...headers };
  if (who) h.cookie = cookies[who]!;
  if (body !== undefined) h['content-type'] = 'application/json';
  return app.request(path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function signUp(name: string) {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${name}@example.com`, password: 'correct horse battery staple', name }),
  });
  expect(res.status).toBe(200);
  const setCookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  cookies[name] = setCookie;
  ids[name] = ((await res.json()) as { user: { id: string } }).user.id;
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const env = EnvSchema.parse({ APP_ENV: 'test', BETTER_AUTH_SECRET: 'x'.repeat(40), DATABASE_URL: 'postgres://unused', MAX_COST_PER_RUN: '0.25', MONTHLY_COST_LIMIT: '10' });
  app = createApp({ db, env, auth: createAuth(db, env), log: createLogger('test'), store: () => store, connections: () => fakeConnections });
  await signUp('alice');
  await signUp('mallory');
});

afterAll(async () => {
  await close();
});

describe('API auth and CSRF', () => {
  it('rejects unauthenticated access', async () => {
    expect((await req(null, 'GET', '/api/tasks')).status).toBe(401);
  });
  it('rejects state-changing requests from a foreign origin', async () => {
    const r = await req('alice', 'POST', '/api/tasks', { prompt: 'x' }, { origin: 'https://evil.example' });
    expect(r.status).toBe(403);
  });
  it('sign-in works with the seeded-style credentials', async () => {
    const r = await app.request('/api/auth/sign-in/email', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'alice@example.com', password: 'correct horse battery staple' }) });
    expect(r.status).toBe(200);
    const bad = await app.request('/api/auth/sign-in/email', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'alice@example.com', password: 'wrong password!!' }) });
    expect(bad.status).toBe(401);
  });
});

describe('tasks and ownership', () => {
  let taskId: string;
  it('creates a task idempotently and enqueues exactly one start', async () => {
    const a = await req('alice', 'POST', '/api/tasks', { prompt: 'Plan my week', idempotencyKey: 'idem-key-123' });
    const b = await req('alice', 'POST', '/api/tasks', { prompt: 'Plan my week', idempotencyKey: 'idem-key-123' });
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    taskId = ((await a.json()) as { task: { id: string } }).task.id;
    expect(((await b.json()) as { task: { id: string } }).task.id).toBe(taskId);
    const outbox = await db.select().from(schema.workflowOutbox).where(eq(schema.workflowOutbox.refId, taskId));
    expect(outbox.filter((o) => o.kind === 'start_task')).toHaveLength(1);
  });
  it('hides other users’ tasks (404, not 403)', async () => {
    expect((await req('mallory', 'GET', `/api/tasks/${taskId}`)).status).toBe(404);
    expect((await req('mallory', 'GET', `/api/tasks/${taskId}/stream`)).status).toBe(404);
    expect((await req('mallory', 'POST', `/api/tasks/${taskId}/cancel`)).status).toBe(404);
    expect((await req('mallory', 'DELETE', `/api/tasks/${taskId}`)).status).toBe(404);
    expect((await req('alice', 'GET', '/api/tasks/not-a-uuid')).status).toBe(404);
    const list = (await (await req('mallory', 'GET', '/api/tasks')).json()) as { tasks: unknown[] };
    expect(list.tasks).toHaveLength(0);
  });
  it('validates input with zod', async () => {
    expect((await req('alice', 'POST', '/api/tasks', { prompt: '' })).status).toBe(400);
    expect((await req('alice', 'POST', '/api/tasks', { prompt: 'x', allowedDomains: ['http://localhost'] })).status).toBe(400);
  });
  it('refuses to delete a non-terminal task and to wipe data while tasks run', async () => {
    expect((await req('alice', 'DELETE', `/api/tasks/${taskId}`)).status).toBe(409);
    expect((await req('alice', 'DELETE', '/api/me/data')).status).toBe(409);
  });
});

describe('approvals', () => {
  it('only the owner can approve, and only the exact displayed action', async () => {
    const created = (await (await req('alice', 'POST', '/api/tasks', { prompt: 'email Bob' })).json()) as { task: { id: string } };
    const taskId = created.task.id;
    await db.insert(schema.toolCalls).values({ id: `${taskId}:c1`, taskId, ownerId: ids.alice!, step: 0, providerToolCallId: 'c1', toolName: 'gmail_send_email', input: {} });
    const intent = await createIntent(db, {
      ownerId: ids.alice!,
      taskId,
      toolCallId: `${taskId}:c1`,
      toolSlug: 'GMAIL_SEND_EMAIL',
      toolVersion: 'v1',
      connectedAccountId: null,
      args: { recipient_email: 'bob@example.com', subject: 'hi', body: 'hello' },
      destination: { recipient_email: 'bob@example.com' },
      attachments: [],
      expiryMs: 3_600_000,
    });
    const list = (await (await req('alice', 'GET', '/api/approvals')).json()) as { approvals: Array<{ id: string; argsHash: string; nonce: string; args: unknown }> };
    const shown = list.approvals.find((a) => a.id === intent.id)!;
    expect(shown.args).toEqual({ recipient_email: 'bob@example.com', subject: 'hi', body: 'hello' });
    expect(((await (await req('mallory', 'GET', '/api/approvals')).json()) as { approvals: unknown[] }).approvals).toHaveLength(0);

    expect((await req('mallory', 'POST', `/api/approvals/${intent.id}`, { decision: 'approved', argsHash: shown.argsHash, nonce: shown.nonce })).status).toBe(404);
    const wrong = await req('alice', 'POST', `/api/approvals/${intent.id}`, { decision: 'approved', argsHash: 'a'.repeat(64), nonce: shown.nonce });
    expect(wrong.status).toBe(409);
    expect(((await wrong.json()) as { error: string }).error).toBe('hash_mismatch');
    expect((await req('alice', 'POST', `/api/approvals/${intent.id}`, { decision: 'approved', argsHash: shown.argsHash, nonce: shown.nonce })).status).toBe(200);
    expect((await req('alice', 'POST', `/api/approvals/${intent.id}`, { decision: 'approved', argsHash: shown.argsHash, nonce: shown.nonce })).status).toBe(409);
    expect((await getIntentForOwner(db, ids.alice!, intent.id)).status).toBe('approved');
    const sig = await db.select().from(schema.workflowOutbox).where(eq(schema.workflowOutbox.refId, intent.id));
    expect(sig.map((s) => s.kind)).toEqual(['signal_approval']);
  });
});

describe('connections', () => {
  it('initiates a Connect Link and verifies via stored id for the owner only', async () => {
    const r = await req('alice', 'POST', '/api/connections', { toolkit: 'github' });
    expect(r.status).toBe(201);
    const { connectionId, redirectUrl } = (await r.json()) as { connectionId: string; redirectUrl: string };
    expect(redirectUrl).toMatch(/^https:\/\/connect\.composio\.dev\//);

    const spoof = await req('mallory', 'GET', `/api/connections/callback?cid=${connectionId}&status=success&connected_account_id=ca_evil`);
    expect(spoof.headers.get('location')).toContain('result=not_found');

    const ok = await req('alice', 'GET', `/api/connections/callback?cid=${connectionId}&connected_account_id=ca_evil`);
    expect(ok.status).toBe(302);
    expect(ok.headers.get('location')).toContain('result=active');
    expect(verifyCalls.at(-1)).toBe(`sa_user_${ids.alice}:ca_github_1`);
    const list = (await (await req('alice', 'GET', '/api/connections')).json()) as { connections: Array<Record<string, unknown>> };
    expect(list.connections[0]).toMatchObject({ toolkit: 'github', status: 'active' });
    expect(JSON.stringify(list)).not.toContain('ca_github_1');
  });
});

describe('artifacts, memory, schedules, budget', () => {
  it('streams artifacts only to their owner with safe headers', async () => {
    const put = await store.put('owners/x/misc/a/report.md', new TextEncoder().encode('# hi'), 'text/markdown');
    const a = await insertArtifact(db, { ownerId: ids.alice!, taskId: null, name: 'report.md', contentType: 'text/markdown', sizeBytes: 4, sha256: put.sha256, objectKey: 'owners/x/misc/a/report.md', source: {}, expiresAt: new Date(Date.now() + 86_400_000) });
    expect((await req('mallory', 'GET', `/api/artifacts/${a.id}/download`)).status).toBe(404);
    const r = await req('alice', 'GET', `/api/artifacts/${a.id}/download?inline=1`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(r.headers.get('content-security-policy')).toContain('sandbox');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await r.text()).toBe('# hi');
  });

  it('memory is editable and hard-deleted', async () => {
    const m = (await (await req('alice', 'POST', '/api/memories', { content: 'I prefer metric units' })).json()) as { memory: { id: string } };
    expect((await req('mallory', 'PATCH', `/api/memories/${m.memory.id}`, { content: 'pwned' })).status).toBe(404);
    expect((await req('alice', 'PATCH', `/api/memories/${m.memory.id}`, { content: 'I prefer Celsius' })).status).toBe(200);
    expect((await req('alice', 'DELETE', `/api/memories/${m.memory.id}`)).status).toBe(200);
    expect(await db.select().from(schema.memories).where(eq(schema.memories.id, m.memory.id))).toHaveLength(0);
  });

  it('schedules require an IANA timezone and go through the outbox', async () => {
    expect((await req('alice', 'POST', '/api/schedules', { name: 'Daily', prompt: 'brief me', spec: { kind: 'cron', cron: '0 8 * * 1-5' }, timezone: 'Mars/Olympus' })).status).toBe(400);
    expect((await req('alice', 'POST', '/api/schedules', { name: 'Fast', prompt: 'x', spec: { kind: 'interval', everyMinutes: 1 }, timezone: 'UTC' })).status).toBe(400);
    const r = await req('alice', 'POST', '/api/schedules', { name: 'Daily', prompt: 'brief me', spec: { kind: 'cron', cron: '0 8 * * 1-5' }, timezone: 'America/Toronto' });
    expect(r.status).toBe(201);
    const s = ((await r.json()) as { schedule: { id: string; readOnly: boolean; temporalScheduleId: string } }).schedule;
    expect(s.readOnly).toBe(true);
    expect(s.temporalScheduleId).toBe(`sched-${s.id}`);
    expect((await req('mallory', 'POST', `/api/schedules/${s.id}/pause`)).status).toBe(404);
    expect((await req('alice', 'POST', `/api/schedules/${s.id}/pause`)).status).toBe(200);
    const kinds = (await db.select().from(schema.workflowOutbox).where(eq(schema.workflowOutbox.refId, s.id))).map((o) => o.kind).sort();
    expect(kinds).toEqual(['create_schedule', 'pause_schedule']);
  });

  it('user budget settings can only tighten installation caps', async () => {
    const loose = (await (await req('alice', 'PUT', '/api/settings/budget', { maxCostPerRunUsd: '100', monthlyLimitUsd: '1000' })).json()) as { effective: { perRunUsd: string; monthlyUsd: string } };
    expect(loose.effective).toEqual({ perRunUsd: '0.25', monthlyUsd: '10' });
    const tight = (await (await req('alice', 'PUT', '/api/settings/budget', { maxCostPerRunUsd: '0.05', monthlyLimitUsd: '2' })).json()) as { effective: { perRunUsd: string; monthlyUsd: string } };
    expect(tight.effective).toEqual({ perRunUsd: '0.05', monthlyUsd: '2' });
  });

  it('setup status reports presence only, never values', async () => {
    const r = await (await req('alice', 'GET', '/api/setup/status')).text();
    expect(r).not.toContain('xxxxxxxx');
    expect(r).toContain('"gateway"');
  });
});
