/**
 * Runs the real deterministic workflows on a real local Temporal dev server (the installed
 * `temporal` CLI) with fake Activities, covering approval waits, forged signals, rejection, expiry,
 * cancellation, unknown outcomes, limits, worker restart mid-wait, schedules-as-child and replay.
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import {
  DefaultLogger,
  Runtime,
  Worker,
  bundleWorkflowCode,
  type WorkflowBundleWithSourceMap,
} from '@temporalio/worker';
import { WorkflowFailedError } from '@temporalio/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AgentActivities, DecisionResult, ProposalVerdict } from '@superagent/contracts/workflow';
import { APPROVAL_SIGNAL, QUESTION_SIGNAL } from '@superagent/contracts/workflow';

const WORKFLOWS = fileURLToPath(new URL('../src/index.ts', import.meta.url));
let env: TestWorkflowEnvironment;
let bundle: WorkflowBundleWithSourceMap;
let queueSeq = 0;

beforeAll(async () => {
  Runtime.install({ logger: new DefaultLogger('WARN') });
  const path = execSync('command -v temporal').toString().trim();
  env = await TestWorkflowEnvironment.createLocal({
    server: { executable: { type: 'existing-path', path }, ip: '127.0.0.1', ui: false },
  });
  bundle = await bundleWorkflowCode({ workflowsPath: WORKFLOWS, logger: new DefaultLogger('WARN') });
}, 180_000);

afterAll(async () => {
  await env?.teardown();
});

type Script = {
  decisions: DecisionResult[];
  verdicts?: Record<string, ProposalVerdict>;
  approvalStates?: Array<'approved' | 'rejected' | 'pending' | 'expired'>;
  executeApprovedThrows?: boolean;
  questionStates?: Array<'answered' | 'pending' | 'expired' | 'cancelled'>;
  confirmed?: boolean;
};

function fakeActivities(s: Script) {
  const calls: Array<{ name: string; arg: unknown }> = [];
  let decisionIdx = 0;
  let approvalIdx = 0;
  let questionIdx = 0;
  const log = (name: string, arg: unknown) => calls.push({ name, arg });
  const acts: AgentActivities = {
    loadTaskContext: async (r) => (
      log('loadTaskContext', r),
      {
        status: 'ready',
        readOnly: false,
        limits: { maxDecisions: 5, maxToolCalls: 4, maxActiveMs: 60_000, approvalExpiryMs: 5_000 },
      }
    ),
    modelDecision: async (r) => {
      log('modelDecision', r);
      return s.decisions[decisionIdx++] ?? { kind: 'final', step: r.step };
    },
    evaluateProposal: async (r) => (
      log('evaluateProposal', r),
      s.verdicts?.[r.toolCallId] ?? { verdict: 'allow', toolCallId: r.toolCallId, executor: 'local' }
    ),
    recordToolOutcome: async (r) => void log('recordToolOutcome', r),
    executeTool: async (r) => (log('executeTool', r), { toolCallId: r.toolCallId, ok: true, summary: 'ok' }),
    prepareForApprovalWait: async (r) => void log('prepareForApprovalWait', r),
    checkApproval: async (r) => {
      log('checkApproval', r);
      return { state: s.approvalStates?.[approvalIdx++] ?? 'pending' };
    },
    resumeAfterApproval: async (r) => void log('resumeAfterApproval', r),
    executeApprovedAction: async (r) => {
      log('executeApprovedAction', r);
      if (s.executeApprovedThrows) throw new Error('socket hang up');
      return { state: 'confirmed', summary: 'sent' };
    },
    reconcileAttempt: async (r) => (log('reconcileAttempt', r), { state: 'unknown', summary: 'unknown' }),
    recordApprovalOutcome: async (r) => void log('recordApprovalOutcome', r),
    prepareForQuestionWait: async (r) => void log('prepareForQuestionWait', r),
    checkQuestion: async (r) => {
      log('checkQuestion', r);
      const state = s.questionStates?.[questionIdx++] ?? 'pending';
      return state === 'answered' ? { state, confirmed: s.confirmed ?? true } : { state };
    },
    recordQuestionOutcome: async (r) => (
      log('recordQuestionOutcome', r),
      { runGatedTool: r.gate && r.state === 'answered' && (s.confirmed ?? true) }
    ),
    finalizeTask: async (f) => void log('finalizeTask', f),
    releaseTaskResources: async (r) => void log('releaseTaskResources', r),
    createScheduledTask: async (i) => (
      log('createScheduledTask', i),
      { taskId: '00000000-0000-4000-8000-0000000000aa' }
    ),
    runRetention: async () => (log('runRetention', {}), { tasks: 0, artifacts: 0 }),
  };
  const count = (name: string) => calls.filter((c) => c.name === name).length;
  const find = (name: string) => calls.filter((c) => c.name === name).map((c) => c.arg as Record<string, unknown>);
  return { acts, calls, count, find };
}

async function makeWorker(acts: AgentActivities, taskQueue: string) {
  return Worker.create({
    connection: env.nativeConnection,
    namespace: env.namespace ?? 'default',
    taskQueue,
    workflowBundle: bundle,
    activities: acts,
  });
}

const tools = (step: number, ...ids: string[]): DecisionResult => ({
  kind: 'tools',
  step,
  proposals: ids.map((id) => ({ toolCallId: id, toolName: 'x' })),
});
const approvalVerdict = (id: string, ms = 60_000): ProposalVerdict => ({
  verdict: 'needs_approval',
  toolCallId: id,
  intentId: `intent-${id}`,
  expiresAtMs: Date.now() + ms,
});
const questionVerdict = (id: string, gate: boolean, ms = 60_000): ProposalVerdict => ({
  verdict: 'needs_answer',
  toolCallId: id,
  questionId: `q-${id}`,
  expiresAtMs: Date.now() + ms,
  gate,
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      srv.close(() => (typeof addr === 'object' && addr ? resolve(addr.port) : reject(new Error('no port'))));
    });
  });
}

async function waitFor(pred: () => boolean, timeoutMs = 15_000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('agentTaskWorkflow on a local Temporal dev server', () => {
  it('runs decisions, executes allowed tools and completes', async () => {
    const f = fakeActivities({ decisions: [tools(0, 'a', 'b'), { kind: 'final', step: 1 }] });
    const q = `t${++queueSeq}`;
    const w = await makeWorker(f.acts, q);
    const r = await w.runUntil(
      env.client.workflow.execute('agentTaskWorkflow', {
        taskQueue: q,
        workflowId: `wf-${q}`,
        args: [{ taskId: 't1', ownerId: 'o1' }],
      }),
    );
    expect(r).toBe('completed');
    expect(f.count('executeTool')).toBe(2);
    expect(f.find('finalizeTask')).toEqual([{ taskId: 't1', ownerId: 'o1', status: 'completed' }]);
    expect(f.count('releaseTaskResources')).toBe(1);
  });

  it('waits for approval, re-checks persisted state, executes exactly once', async () => {
    const f = fakeActivities({
      decisions: [tools(0, 'send')],
      verdicts: { send: approvalVerdict('send') },
      approvalStates: ['approved'],
    });
    const q = `t${++queueSeq}`;
    const w = await makeWorker(f.acts, q);
    await w.runUntil(async () => {
      const h = await env.client.workflow.start('agentTaskWorkflow', {
        taskQueue: q,
        workflowId: `wf-${q}`,
        args: [{ taskId: 't2', ownerId: 'o1' }],
      });
      await waitFor(() => f.count('prepareForApprovalWait') === 1);
      expect(f.count('executeApprovedAction')).toBe(0);
      await h.signal(APPROVAL_SIGNAL, { intentId: 'intent-send' });
      expect(await h.result()).toBe('completed');
    });
    expect(f.count('checkApproval')).toBe(1);
    expect(f.count('executeApprovedAction')).toBe(1);
    expect(f.calls.findIndex((c) => c.name === 'prepareForApprovalWait')).toBeLessThan(
      f.calls.findIndex((c) => c.name === 'executeApprovedAction'),
    );
  });

  it('a signal without a persisted approval does not execute; the intent expires on the durable timer', async () => {
    const f = fakeActivities({
      decisions: [tools(0, 'send')],
      verdicts: { send: approvalVerdict('send', 2_500) },
      approvalStates: ['pending'],
    });
    const q = `t${++queueSeq}`;
    const w = await makeWorker(f.acts, q);
    await w.runUntil(async () => {
      const h = await env.client.workflow.start('agentTaskWorkflow', {
        taskQueue: q,
        workflowId: `wf-${q}`,
        args: [{ taskId: 't3', ownerId: 'o1' }],
      });
      await waitFor(() => f.count('prepareForApprovalWait') === 1);
      await h.signal(APPROVAL_SIGNAL, { intentId: 'intent-send' });
      await h.signal(APPROVAL_SIGNAL, { intentId: 'intent-unrelated' });
      expect(await h.result()).toBe('completed');
    });
    expect(f.count('executeApprovedAction')).toBe(0);
    expect(f.find('recordApprovalOutcome')[0]).toMatchObject({ state: 'expired' });
  }, 30_000);

  it('rejection records the outcome and never executes', async () => {
    const f = fakeActivities({
      decisions: [tools(0, 'send')],
      verdicts: { send: approvalVerdict('send') },
      approvalStates: ['rejected'],
    });
    const q = `t${++queueSeq}`;
    const w = await makeWorker(f.acts, q);
    await w.runUntil(async () => {
      const h = await env.client.workflow.start('agentTaskWorkflow', {
        taskQueue: q,
        workflowId: `wf-${q}`,
        args: [{ taskId: 't4', ownerId: 'o1' }],
      });
      await waitFor(() => f.count('prepareForApprovalWait') === 1);
      await h.signal(APPROVAL_SIGNAL, { intentId: 'intent-send' });
      await h.result();
    });
    expect(f.count('executeApprovedAction')).toBe(0);
    expect(f.find('recordApprovalOutcome')[0]).toMatchObject({ state: 'rejected' });
  });

  it('a failed external write is reconciled, not retried', async () => {
    const f = fakeActivities({
      decisions: [tools(0, 'send')],
      verdicts: { send: approvalVerdict('send') },
      approvalStates: ['approved'],
      executeApprovedThrows: true,
    });
    const q = `t${++queueSeq}`;
    const w = await makeWorker(f.acts, q);
    await w.runUntil(async () => {
      const h = await env.client.workflow.start('agentTaskWorkflow', {
        taskQueue: q,
        workflowId: `wf-${q}`,
        args: [{ taskId: 't5', ownerId: 'o1' }],
      });
      await waitFor(() => f.count('prepareForApprovalWait') === 1);
      await h.signal(APPROVAL_SIGNAL, { intentId: 'intent-send' });
      await h.result();
    });
    expect(f.count('executeApprovedAction')).toBe(1);
    expect(f.count('reconcileAttempt')).toBe(1);
  });

  it('ask_user waits durably for a persisted answer, then continues the loop', async () => {
    const f = fakeActivities({
      decisions: [tools(0, 'ask'), { kind: 'final', step: 1 }],
      verdicts: { ask: questionVerdict('ask', false) },
      questionStates: ['pending', 'answered'],
    });
    const q = `t${++queueSeq}`;
    const w = await makeWorker(f.acts, q);
    await w.runUntil(async () => {
      const h = await env.client.workflow.start('agentTaskWorkflow', {
        taskQueue: q,
        workflowId: `wf-${q}`,
        args: [{ taskId: 'tq1', ownerId: 'o1' }],
      });
      await waitFor(() => f.count('prepareForQuestionWait') === 1);
      // A signal is only a wake-up: the first re-read still says pending, so the run keeps waiting.
      await h.signal(QUESTION_SIGNAL, { questionId: 'q-ask' });
      await waitFor(() => f.count('checkQuestion') === 1);
      expect(f.count('recordQuestionOutcome')).toBe(0);
      await h.signal(QUESTION_SIGNAL, { questionId: 'q-unrelated' });
      await h.signal(QUESTION_SIGNAL, { questionId: 'q-ask' });
      expect(await h.result()).toBe('completed');
    });
    expect(f.count('checkQuestion')).toBe(2);
    expect(f.find('recordQuestionOutcome')).toEqual([
      expect.objectContaining({ questionId: 'q-ask', gate: false, state: 'answered' }),
    ]);
    expect(f.count('executeTool')).toBe(0);
    expect(f.count('modelDecision')).toBe(2);
  });

  it('a confirm gate runs the tool only after Yes', async () => {
    const yes = fakeActivities({
      decisions: [tools(0, 'sched')],
      verdicts: { sched: questionVerdict('sched', true) },
      questionStates: ['answered'],
      confirmed: true,
    });
    const no = fakeActivities({
      decisions: [tools(0, 'sched')],
      verdicts: { sched: questionVerdict('sched', true) },
      questionStates: ['answered'],
      confirmed: false,
    });
    for (const [f, n] of [
      [yes, 1],
      [no, 0],
    ] as const) {
      const q = `t${++queueSeq}`;
      const w = await makeWorker(f.acts, q);
      await w.runUntil(async () => {
        const h = await env.client.workflow.start('agentTaskWorkflow', {
          taskQueue: q,
          workflowId: `wf-${q}`,
          args: [{ taskId: `tq-${q}`, ownerId: 'o1' }],
        });
        await waitFor(() => f.count('prepareForQuestionWait') === 1);
        await h.signal(QUESTION_SIGNAL, { questionId: 'q-sched' });
        expect(await h.result()).toBe('completed');
      });
      expect(f.count('executeTool')).toBe(n);
    }
  });

  it('an unanswered question expires on the durable timer and the run carries on', async () => {
    const f = fakeActivities({ decisions: [tools(0, 'ask')], verdicts: { ask: questionVerdict('ask', true, 2_500) } });
    const q = `t${++queueSeq}`;
    const w = await makeWorker(f.acts, q);
    await w.runUntil(async () => {
      const h = await env.client.workflow.start('agentTaskWorkflow', {
        taskQueue: q,
        workflowId: `wf-${q}`,
        args: [{ taskId: 'tq3', ownerId: 'o1' }],
      });
      expect(await h.result()).toBe('completed');
    });
    expect(f.find('recordQuestionOutcome')).toEqual([expect.objectContaining({ state: 'expired', gate: true })]);
    expect(f.count('executeTool')).toBe(0);
  }, 30_000);

  it('cancellation during an approval wait finalizes as cancelled and releases resources', async () => {
    const f = fakeActivities({ decisions: [tools(0, 'send')], verdicts: { send: approvalVerdict('send') } });
    const q = `t${++queueSeq}`;
    const w = await makeWorker(f.acts, q);
    await w.runUntil(async () => {
      const h = await env.client.workflow.start('agentTaskWorkflow', {
        taskQueue: q,
        workflowId: `wf-${q}`,
        args: [{ taskId: 't6', ownerId: 'o1' }],
      });
      await waitFor(() => f.count('prepareForApprovalWait') === 1);
      await h.cancel();
      await expect(h.result()).rejects.toBeInstanceOf(WorkflowFailedError);
    });
    expect(f.find('finalizeTask')).toEqual([{ taskId: 't6', ownerId: 'o1', status: 'cancelled' }]);
    expect(f.count('releaseTaskResources')).toBe(1);
    expect(f.count('executeApprovedAction')).toBe(0);
  });

  it('enforces the per-run tool-call and decision limits', async () => {
    const f = fakeActivities({
      decisions: [
        tools(0, 'a', 'b', 'c'),
        tools(1, 'd', 'e'),
        tools(2, 'f'),
        tools(3, 'g'),
        tools(4, 'h'),
        tools(5, 'i'),
      ],
    });
    const q = `t${++queueSeq}`;
    const w = await makeWorker(f.acts, q);
    const r = await w.runUntil(
      env.client.workflow.execute('agentTaskWorkflow', {
        taskQueue: q,
        workflowId: `wf-${q}`,
        args: [{ taskId: 't7', ownerId: 'o1' }],
      }),
    );
    expect(r).toBe('failed');
    expect(f.count('executeTool')).toBe(4);
    expect(f.find('recordToolOutcome').every((x) => x.status === 'denied')).toBe(true);
    expect(f.count('modelDecision')).toBe(5);
    expect(String(f.find('finalizeTask')[0]?.reason)).toMatch(/decision limit/);
  });

  it('survives a worker restart during an approval wait (state lives in Temporal)', async () => {
    const f = fakeActivities({
      decisions: [tools(0, 'send')],
      verdicts: { send: approvalVerdict('send') },
      approvalStates: ['approved'],
    });
    const q = `t${++queueSeq}`;
    const w1 = await makeWorker(f.acts, q);
    const h = await w1.runUntil(async () => {
      const handle = await env.client.workflow.start('agentTaskWorkflow', {
        taskQueue: q,
        workflowId: `wf-${q}`,
        args: [{ taskId: 't8', ownerId: 'o1' }],
      });
      await waitFor(() => f.count('prepareForApprovalWait') === 1);
      return handle;
    });
    await h.signal(APPROVAL_SIGNAL, { intentId: 'intent-send' });
    const w2 = await Worker.create({
      connection: env.nativeConnection,
      namespace: env.namespace ?? 'default',
      taskQueue: q,
      workflowBundle: bundle,
      activities: f.acts,
      maxCachedWorkflows: 0,
    });
    expect(await w2.runUntil(h.result())).toBe('completed');
    expect(f.count('executeApprovedAction')).toBe(1);
    expect(f.count('modelDecision')).toBe(2);

    const history = await h.fetchHistory();
    await Worker.runReplayHistory({ workflowBundle: bundle }, history, h.workflowId);
  }, 60_000);

  it('survives a Temporal server restart during an approval wait (persisted dev-server DB)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sa-temporal-'));
    const port = await freePort();
    const serverPath = execSync('command -v temporal').toString().trim();
    const start = () =>
      TestWorkflowEnvironment.createLocal({
        server: {
          executable: { type: 'existing-path', path: serverPath },
          ip: '127.0.0.1',
          port,
          ui: false,
          dbFilename: join(dir, 'temporal.db'),
        },
      });
    const f = fakeActivities({
      decisions: [tools(0, 'send')],
      verdicts: { send: approvalVerdict('send') },
      approvalStates: ['approved'],
    });
    const q = `t${++queueSeq}`;
    try {
      const env1 = await start();
      const w1 = await Worker.create({
        connection: env1.nativeConnection,
        namespace: 'default',
        taskQueue: q,
        workflowBundle: bundle,
        activities: f.acts,
      });
      const workflowId = await w1.runUntil(async () => {
        const handle = await env1.client.workflow.start('agentTaskWorkflow', {
          taskQueue: q,
          workflowId: `wf-${q}`,
          args: [{ taskId: 't9', ownerId: 'o1' }],
        });
        await waitFor(() => f.count('prepareForApprovalWait') === 1);
        return handle.workflowId;
      });
      await env1.teardown();

      const env2 = await start();
      try {
        const h = env2.client.workflow.getHandle(workflowId);
        expect((await h.describe()).status.name).toBe('RUNNING');
        await h.signal(APPROVAL_SIGNAL, { intentId: 'intent-send' });
        const w2 = await Worker.create({
          connection: env2.nativeConnection,
          namespace: 'default',
          taskQueue: q,
          workflowBundle: bundle,
          activities: f.acts,
        });
        expect(await w2.runUntil(h.result())).toBe('completed');
      } finally {
        await env2.teardown();
      }
      expect(f.count('prepareForApprovalWait')).toBe(1);
      expect(f.count('executeApprovedAction')).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('scheduledTaskWorkflow creates the task idempotently and runs it as a child', async () => {
    const f = fakeActivities({ decisions: [{ kind: 'final', step: 0 }] });
    const q = `t${++queueSeq}`;
    const w = await makeWorker(f.acts, q);
    const r = await w.runUntil(
      env.client.workflow.execute('scheduledTaskWorkflow', {
        taskQueue: q,
        workflowId: `sched-run-${q}`,
        args: [{ scheduleId: 's1', ownerId: 'o1' }],
      }),
    );
    expect(r).toBe('completed');
    expect(f.find('createScheduledTask')[0]).toMatchObject({ scheduleId: 's1', runKey: `sched-run-${q}` });
    expect(f.find('loadTaskContext')[0]).toMatchObject({ taskId: '00000000-0000-4000-8000-0000000000aa' });
  });
});
