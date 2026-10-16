/**
 * Deterministic Temporal Workflow definitions. No I/O, SDK clients, DB, filesystem, host timers or
 * Math.random here: all side effects happen in Activities; time and timers come from the Temporal
 * workflow runtime (Date.now() is replay-safe inside workflows).
 */
import {
  ApplicationFailure,
  CancellationScope,
  ContinueAsNew,
  ParentClosePolicy,
  WorkflowIdReusePolicy,
  condition,
  continueAsNew,
  defineSignal,
  executeChild,
  isCancellation,
  proxyActivities,
  setHandler,
  workflowInfo,
} from '@temporalio/workflow';
import {
  APPROVAL_SIGNAL,
  QUESTION_SIGNAL,
  taskWorkflowId,
  type AgentActivities,
  type AgentCarryState,
  type AgentTaskInput,
  type ApprovalSignal,
  type QuestionSignal,
  type ScheduledTaskInput,
} from '@superagent/contracts/workflow';

const NON_RETRYABLE = ['BudgetExceededError', 'SetupRequiredError', 'PartialOutputError', 'ModelConfigError', 'NotFoundError', 'ApprovalError', 'PolicyError'];

/** Quick DB/projection Activities: idempotent, safe to retry. */
const db = proxyActivities<AgentActivities>({
  startToCloseTimeout: '30 seconds',
  retry: { initialInterval: '1 second', backoffCoefficient: 2, maximumInterval: '30 seconds', maximumAttempts: 8, nonRetryableErrorTypes: NON_RETRYABLE },
});

/** Model decisions cost money: one retry at most (the Activity itself dedupes per step). */
const llm = proxyActivities<AgentActivities>({
  startToCloseTimeout: '3 minutes',
  retry: { initialInterval: '5 seconds', maximumAttempts: 2, nonRetryableErrorTypes: NON_RETRYABLE },
});

/** Tool execution (E2B/browser/connector reads): heartbeated, cancellable, not blindly retried. */
const tools = proxyActivities<AgentActivities>({
  startToCloseTimeout: '6 minutes',
  heartbeatTimeout: '45 seconds',
  cancellationType: 'WAIT_CANCELLATION_COMPLETED',
  retry: { maximumAttempts: 1 },
});

/** Non-idempotent external writes: never automatically retried. Uncertainty is reconciled explicitly. */
const writes = proxyActivities<AgentActivities>({
  startToCloseTimeout: '2 minutes',
  retry: { maximumAttempts: 1 },
});

export const approvalDecided = defineSignal<[ApprovalSignal]>(APPROVAL_SIGNAL);
export const questionAnswered = defineSignal<[QuestionSignal]>(QUESTION_SIGNAL);

function reasonOf(err: unknown): string {
  let e: unknown = err;
  for (let i = 0; i < 4 && e; i++) {
    const cause = (e as { cause?: unknown }).cause;
    if (!cause) break;
    e = cause;
  }
  const msg = e instanceof Error ? e.message : String(e);
  return msg.slice(0, 500);
}

export async function agentTaskWorkflow(input: AgentTaskInput): Promise<string> {
  const { taskId, ownerId } = input;
  const signalled = new Set<string>();
  setHandler(approvalDecided, ({ intentId }) => {
    signalled.add(intentId);
  });
  const answered = new Set<string>();
  setHandler(questionAnswered, ({ questionId }) => {
    answered.add(questionId);
  });

  const carry: AgentCarryState = input.carry ?? { step: 0, toolCalls: 0, activeMs: 0, pendingIntentIds: [] };
  let { step, toolCalls, activeMs } = carry;
  let continuing = false;
  let segmentStart = Date.now();
  const tick = () => {
    const now = Date.now();
    activeMs += now - segmentStart;
    segmentStart = now;
  };

  try {
    const ctx = await db.loadTaskContext({ taskId, ownerId });
    if (ctx.status === 'terminal') return 'terminal';
    const { limits } = ctx;

    for (;;) {
      tick();
      if (step >= limits.maxDecisions) {
        await db.finalizeTask({ taskId, ownerId, status: 'failed', reason: `stopped: reached the ${limits.maxDecisions}-decision limit for one run` });
        return 'failed';
      }
      if (activeMs >= limits.maxActiveMs) {
        await db.finalizeTask({ taskId, ownerId, status: 'failed', reason: 'stopped: reached the active execution time limit for one run' });
        return 'failed';
      }

      const decision = await llm.modelDecision({ taskId, ownerId, step });
      if (decision.kind === 'error') {
        await db.finalizeTask({ taskId, ownerId, status: 'failed', reason: decision.reason });
        return 'failed';
      }
      if (decision.kind === 'final') {
        await db.finalizeTask({ taskId, ownerId, status: 'completed' });
        return 'completed';
      }

      for (const p of decision.proposals) {
        const ref = { taskId, ownerId, toolCallId: p.toolCallId };
        toolCalls += 1;
        if (toolCalls > limits.maxToolCalls) {
          await db.recordToolOutcome({ ...ref, status: 'denied', summary: `tool-call limit (${limits.maxToolCalls}) reached for this run` });
          continue;
        }
        const verdict = await db.evaluateProposal({ ...ref, readOnly: ctx.readOnly });
        if (verdict.verdict === 'deny') continue;
        if (verdict.verdict === 'needs_answer') {
          // Ask in chat and wait durably (no compute while waiting; survives deploys and restarts).
          const q = { ...ref, questionId: verdict.questionId };
          tick();
          await db.prepareForQuestionWait(q);
          let state: 'answered' | 'expired' | 'cancelled' | 'pending' = 'pending';
          while (state === 'pending') {
            const remaining = verdict.expiresAtMs - Date.now();
            if (remaining <= 0 || !(await condition(() => answered.has(verdict.questionId), remaining))) {
              state = 'expired';
              break;
            }
            answered.delete(verdict.questionId);
            // A raw signal is not an answer: re-read the persisted, owner-checked row.
            state = (await db.checkQuestion(q)).state;
          }
          segmentStart = Date.now();
          const { runGatedTool } = await db.recordQuestionOutcome({ ...q, gate: verdict.gate, state });
          if (runGatedTool) {
            try {
              await tools.executeTool(ref);
            } catch (err) {
              if (isCancellation(err)) throw err;
              await db.recordToolOutcome({ ...ref, status: 'failed', summary: `tool failed: ${reasonOf(err)}` });
            }
          }
          continue;
        }
        if (verdict.verdict === 'allow') {
          try {
            await tools.executeTool(ref);
          } catch (err) {
            if (isCancellation(err)) throw err;
            await db.recordToolOutcome({ ...ref, status: 'failed', summary: `tool failed: ${reasonOf(err)}` });
          }
          continue;
        }

        // Exact-action approval: release resources, then wait durably (timer survives restarts).
        const intent = { ...ref, intentId: verdict.intentId };
        tick();
        await db.prepareForApprovalWait(intent);
        let state: 'approved' | 'rejected' | 'expired' | 'pending' = 'pending';
        while (state === 'pending') {
          const remaining = verdict.expiresAtMs - Date.now();
          if (remaining <= 0) {
            state = 'expired';
            break;
          }
          const got = await condition(() => signalled.has(verdict.intentId), remaining);
          if (!got) {
            state = 'expired';
            break;
          }
          signalled.delete(verdict.intentId);
          // A raw signal is not authorization: re-read the persisted, owner-checked approval.
          state = (await db.checkApproval(intent)).state;
        }
        segmentStart = Date.now();
        await db.resumeAfterApproval({ taskId, ownerId });
        if (state === 'approved') {
          try {
            await writes.executeApprovedAction(intent);
          } catch (err) {
            if (isCancellation(err)) throw err;
            await db.reconcileAttempt({ ...intent, error: reasonOf(err) });
          }
        } else {
          await db.recordApprovalOutcome({ ...intent, state });
        }
      }

      step += 1;
      if (workflowInfo().continueAsNewSuggested) {
        tick();
        continuing = true;
        await continueAsNew<typeof agentTaskWorkflow>({ taskId, ownerId, carry: { step, toolCalls, activeMs, pendingIntentIds: [] } });
      }
    }
  } catch (err) {
    if (err instanceof ContinueAsNew) throw err;
    if (isCancellation(err)) {
      await CancellationScope.nonCancellable(() => db.finalizeTask({ taskId, ownerId, status: 'cancelled' }));
      throw err;
    }
    await CancellationScope.nonCancellable(() => db.finalizeTask({ taskId, ownerId, status: 'failed', reason: reasonOf(err) }));
    return 'failed';
  } finally {
    if (!continuing) await CancellationScope.nonCancellable(() => db.releaseTaskResources({ taskId, ownerId }));
  }
}

/**
 * Started by a Temporal Schedule. Creates (idempotently, keyed by this run's workflow id) a task
 * row and runs it as a child. The schedule's SKIP overlap policy covers the whole child duration.
 */
export async function scheduledTaskWorkflow(input: ScheduledTaskInput): Promise<string> {
  const { taskId } = await db.createScheduledTask({ ...input, runKey: workflowInfo().workflowId });
  if (!taskId) return 'skipped';
  return executeChild(agentTaskWorkflow, {
    workflowId: taskWorkflowId(taskId),
    args: [{ taskId, ownerId: input.ownerId }],
    parentClosePolicy: ParentClosePolicy.REQUEST_CANCEL,
    workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
  });
}

export async function retentionWorkflow(): Promise<string> {
  const r = await db.runRetention();
  return `expired tasks=${r.tasks} artifacts=${r.artifacts}`;
}

export { ApplicationFailure };
