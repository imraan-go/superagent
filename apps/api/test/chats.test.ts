import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EnvSchema } from '@superagent/config';
import { appendEvent, createQuestion, schema, setTaskStatus, type Db } from '@superagent/db';
import { createLogger } from '@superagent/observability';
import { MemoryArtifactStore } from '@superagent/storage';
import { createApp, type ConnectionsPort } from '../src/app';
import { createAuth } from '../src/auth';
import { newTranslatorState, translate } from '../src/run-events';
import { createTestDb } from '../../../packages/db/test/helpers';

const ORIGIN = 'http://localhost:3000';
const MODEL = 'anthropic/claude-haiku-5.5';
let db: Db;
let close: () => Promise<void>;
let app: ReturnType<typeof createApp>;
const store = new MemoryArtifactStore();
const noConnections = {} as ConnectionsPort;
const cookies: Record<string, string> = {};

async function req(who: string | null, method: string, path: string, body?: unknown) {
  const h: Record<string, string> = { origin: ORIGIN };
  if (who) h.cookie = cookies[who]!;
  if (body !== undefined) h['content-type'] = 'application/json';
  return app.request(path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function json<T>(r: Response): Promise<T> {
  return (await r.json()) as T;
}

async function signUp(name: string) {
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${name}@example.com`, password: 'correct horse battery staple', name }),
  });
  expect(res.status).toBe(200);
  cookies[name] = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  return ((await res.json()) as { user: { id: string } }).user.id;
}

let aliceId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const env = EnvSchema.parse({
    APP_ENV: 'test',
    BETTER_AUTH_SECRET: 'x'.repeat(40),
    DATABASE_URL: 'postgres://unused',
    AI_GATEWAY_API_KEY: 'k',
    AI_MODEL_PRIMARY: MODEL,
    AI_MODEL_ALLOWLIST: `${MODEL},openai/gpt-5.5`,
  });
  app = createApp({
    db,
    env,
    auth: createAuth(db, env),
    log: createLogger('test'),
    store: () => store,
    connections: () => noConnections,
  });
  aliceId = await signUp('alice');
  await signUp('mallory');
});

afterAll(async () => {
  await close();
});

type Chat = {
  id: string;
  title: string;
  status: string | null;
  activeRunId: string | null;
  pendingQuestion: { questionId: string } | null;
  messages: Array<{ role: string; content: Array<{ type: string; text?: string }>; runId: string | null }>;
};

describe('chats', () => {
  let chatId: string;
  let runId: string;

  it('lists models from the installation allowlist', async () => {
    const r = await json<{ models: Array<{ id: string; ready: boolean }>; defaultModel: string }>(
      await req('alice', 'GET', '/api/models'),
    );
    expect(r.models.map((m) => m.id)).toEqual([MODEL, 'openai/gpt-5.5']);
    expect(r.defaultModel).toBe(MODEL);
  });

  it('creates a chat and is owner-scoped', async () => {
    const r = await req('alice', 'POST', '/api/chats', {});
    expect(r.status).toBe(201);
    chatId = (await json<{ chat: { id: string } }>(r)).chat.id;
    expect((await req('mallory', 'GET', `/api/chats/${chatId}`)).status).toBe(404);
    expect((await json<{ chats: unknown[] }>(await req('mallory', 'GET', '/api/chats'))).chats).toHaveLength(0);
  });

  it('a message starts one run (task + outbox start), titles the chat and shows as running', async () => {
    const r = await req('alice', 'POST', `/api/chats/${chatId}/messages`, {
      text: 'Find me a good sushi place nearby',
      model: 'openai/gpt-5.5',
    });
    expect(r.status).toBe(201);
    const body = await json<{ runId: string; model: string }>(r);
    runId = body.runId;
    expect(body.model).toBe('openai/gpt-5.5');
    const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, runId));
    expect(task).toMatchObject({ chatId, model: 'openai/gpt-5.5', ownerId: aliceId });
    expect(await db.select().from(schema.workflowOutbox).where(eq(schema.workflowOutbox.refId, runId))).toHaveLength(1);
    const chat = (await json<{ chat: Chat }>(await req('alice', 'GET', `/api/chats/${chatId}`))).chat;
    expect(chat.title).toBe('Find me a good sushi place nearby');
    expect(chat.status).toBe('running');
    expect(chat.activeRunId).toBe(runId);
    expect(chat.messages.map((m) => m.role)).toEqual(['user']);
  });

  it('refuses a model that is not enabled and a second run while one is active', async () => {
    const other = (await json<{ chat: { id: string } }>(await req('alice', 'POST', '/api/chats', {}))).chat.id;
    expect(
      (await req('alice', 'POST', `/api/chats/${other}/messages`, { text: 'hi', model: 'evil/model' })).status,
    ).toBe(400);
    expect((await req('alice', 'POST', `/api/chats/${chatId}/messages`, { text: 'and another' })).status).toBe(409);
    expect((await req('mallory', 'POST', `/api/chats/${chatId}/messages`, { text: 'hijack' })).status).toBe(404);
  });

  it('a typed message answers a waiting question instead of starting a run', async () => {
    await setTaskStatus(db, aliceId, runId, 'waiting_approval');
    const [tc] = await db
      .insert(schema.toolCalls)
      .values({
        id: `${runId}:q`,
        taskId: runId,
        ownerId: aliceId,
        step: 0,
        providerToolCallId: 'q',
        toolName: 'ask_user',
        input: {},
        status: 'awaiting_answer',
      })
      .returning();
    const q = await createQuestion(db, {
      ownerId: aliceId,
      taskId: runId,
      chatId,
      toolCallId: tc!.id,
      kind: 'single',
      prompt: 'Which area?',
      options: [
        { id: 'a', label: 'Downtown' },
        { id: 'b', label: 'Uptown' },
      ],
      gate: false,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const chat = (await json<{ chat: Chat }>(await req('alice', 'GET', `/api/chats/${chatId}`))).chat;
    expect(chat.status).toBe('paused_question');
    expect(chat.pendingQuestion?.questionId).toBe(q.id);

    const r = await json<{ runId: string; answered: string }>(
      await req('alice', 'POST', `/api/chats/${chatId}/messages`, { text: 'Somewhere near the waterfront' }),
    );
    expect(r).toMatchObject({ runId, answered: q.id });
    const [row] = await db.select().from(schema.questions).where(eq(schema.questions.id, q.id));
    expect(row).toMatchObject({ status: 'answered', answer: { choices: [], text: 'Somewhere near the waterfront' } });
    expect(await db.select().from(schema.tasks).where(eq(schema.tasks.chatId, chatId))).toHaveLength(1);
    expect(
      (await req('alice', 'POST', `/api/chats/${chatId}/answer`, { questionId: q.id, choices: ['a'] })).status,
    ).toBe(409);
  });

  it('streams a run as UI frames and ends with the persisted answer', async () => {
    await appendEvent(db, {
      ownerId: aliceId,
      taskId: runId,
      type: 'tool.started',
      dedupeKey: 't1',
      data: { tool: 'browser_navigate' },
    });
    await appendEvent(db, {
      ownerId: aliceId,
      taskId: runId,
      type: 'tool.completed',
      dedupeKey: 't2',
      data: { tool: 'browser_navigate', summary: 'navigated' },
    });
    await db.insert(schema.chatMessages).values({
      chatId,
      ownerId: aliceId,
      role: 'assistant',
      taskId: runId,
      content: [{ type: 'text', text: 'Try Sushi Nori.' }],
      dedupeKey: `final:${runId}`,
    });
    await setTaskStatus(db, aliceId, runId, 'completed');
    await appendEvent(db, { ownerId: aliceId, taskId: runId, type: 'task.completed', dedupeKey: 'task.completed' });
    const text = await (await req('alice', 'GET', `/api/runs/${runId}/events`)).text();
    const frames = text
      .split('\n')
      .filter((l) => l.startsWith('data: '))
      .map((l) => JSON.parse(l.slice(6)) as { type: string; message?: { content: Array<{ text: string }> } });
    expect(frames.map((f) => f.type)).toEqual(['run_started', 'step', 'step_done', 'message', 'done']);
    expect(frames.at(-1)).toEqual({ type: 'done', status: 'done' });
    expect(frames.find((f) => f.type === 'message')?.message?.content[0]?.text).toBe('Try Sushi Nori.');
    expect((await req('mallory', 'GET', `/api/runs/${runId}/events`)).status).toBe(404);
  });

  it('uploads are validated by content, owner-scoped and listed with the chat', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const upload = async (who: string, name: string, bytes: Uint8Array) => {
      const form = new FormData();
      form.set('file', new File([bytes], name));
      form.set('chatId', chatId);
      return app.request('/api/uploads', {
        method: 'POST',
        headers: { origin: ORIGIN, cookie: cookies[who]! },
        body: form,
      });
    };
    expect((await upload('alice', 'fake.png', new TextEncoder().encode('not a png'))).status).toBe(400);
    expect((await upload('alice', 'run.exe', png)).status).toBe(400);
    expect((await upload('mallory', 'x.png', png)).status).toBe(404);
    const ok = await upload('alice', 'photo.png', png);
    expect(ok.status).toBe(201);
    const file = (await json<{ file: { id: string; mime: string } }>(ok)).file;
    expect(file.mime).toBe('image/png');
    const got = await req('alice', 'GET', `/api/uploads/${file.id}`);
    expect(got.headers.get('content-disposition')).toMatch(/^inline/);
    expect(got.headers.get('content-security-policy')).toContain('sandbox');
    expect((await req('mallory', 'GET', `/api/uploads/${file.id}`)).status).toBe(404);
    const files = (
      await json<{ files: Array<{ id: string; origin: string }> }>(
        await req('alice', 'GET', `/api/chats/${chatId}/files`),
      )
    ).files;
    expect(files).toEqual([expect.objectContaining({ id: file.id, origin: 'upload' })]);
  });

  it('deleting a chat keeps it owner-scoped', async () => {
    expect((await req('mallory', 'DELETE', `/api/chats/${chatId}`)).status).toBe(404);
    expect((await req('alice', 'DELETE', `/api/chats/${chatId}`)).status).toBe(200);
    expect((await req('alice', 'GET', `/api/chats/${chatId}`)).status).toBe(404);
  });
});

describe('run event translation', () => {
  it('pairs tool steps, accumulates usage and maps approvals and failures', () => {
    const s = newTranslatorState();
    const ctx = { runId: 'r', chatId: 'c', model: 'm' };
    const ev = (id: number, type: string, data: Record<string, unknown> = {}) =>
      translate(s, { id, type, data, createdAt: new Date(1_000 * id) }, ctx);
    expect(ev(1, 'task.queued')).toEqual([{ type: 'run_started', runId: 'r', chatId: 'c', model: 'm' }]);
    expect(ev(2, 'model.decision', { inputTokens: 10, outputTokens: 2, costUsd: '0.001' }).at(-1)).toEqual({
      type: 'usage',
      tokensIn: 10,
      tokensOut: 2,
      cached: 0,
      costUsd: 0.001,
    });
    expect(ev(3, 'model.decision', { inputTokens: 5, outputTokens: 1, costUsd: '0.002' }).at(-1)).toMatchObject({
      tokensIn: 15,
      tokensOut: 3,
      costUsd: 0.003,
    });
    const [start] = ev(4, 'tool.started', { tool: 'browser_read' });
    expect(start).toMatchObject({
      type: 'step',
      step: { idx: 0, toolName: 'browser_read', label: 'Reading the page', ok: null },
    });
    expect(ev(6, 'tool.failed', { tool: 'browser_read', summary: 'blocked' })).toEqual([
      { type: 'step_done', step: expect.objectContaining({ idx: 0, ok: false, ms: 2000, preview: 'blocked' }) },
    ]);
    const appr = ev(7, 'approval.requested', { intentId: 'i1', tool: 'GMAIL_SEND_EMAIL', account: 'me@x' });
    expect(appr[1]).toMatchObject({ type: 'approval_required', approvalId: 'i1', tool: 'GMAIL_SEND_EMAIL' });
    expect(ev(8, 'approval.decided', { intentId: 'i1', decision: 'approved' })).toEqual([
      { type: 'approval_decided', approvalId: 'i1', tool: 'GMAIL_SEND_EMAIL', decision: 'approve' },
    ]);
    expect(ev(9, 'task.failed', { reason: 'stopped: reached the 12-decision limit for one run' })).toEqual([
      { type: 'error', code: 'step_limit', message: 'stopped: reached the 12-decision limit for one run' },
    ]);
  });
});
