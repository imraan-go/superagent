import type { ActionOutcome, ApprovalCheck, IntentRef, TaskRef } from '@superagent/contracts/workflow';
import { toolResultMessage } from '@superagent/agent';
import type { Toolkit } from '@superagent/connectors';
import {
  ApprovalError,
  appendMessage,
  beginAttempt,
  checkApproval as checkApprovalRow,
  expireIntent,
  finishAttempt,
  getAttempt,
  getConnectionForOwner,
  getIntentForOwner,
  getToolCall,
  recordUsage,
  setTaskStatus,
  setToolCallStatus,
} from '@superagent/db';
import { emit, type Deps } from './deps';
import { pauseTaskWorkspaces } from './lifecycle';
import { isConnectorSpec, toolRegistry } from './registry';

async function result(d: Deps, ref: IntentRef, ok: boolean, text: string, summary: string) {
  const tc = await getToolCall(d.db, ref.ownerId, ref.toolCallId);
  await appendMessage(d.db, {
    ownerId: ref.ownerId,
    taskId: ref.taskId,
    step: tc.step,
    kind: 'tool_result',
    dedupeKey: `tool:${ref.toolCallId}`,
    content: toolResultMessage(tc.providerToolCallId, tc.toolName, ok ? { type: 'text', value: text } : { type: 'error-text', value: text }),
  });
  await setToolCallStatus(d.db, ref.ownerId, ref.toolCallId, ok ? 'done' : 'failed', summary);
}

const UNKNOWN_TEXT =
  'OUTCOME UNKNOWN: the request was sent but no reliable confirmation was received. It was NOT retried to avoid a duplicate. Tell the user to check their account before trying again.';

export async function prepareForApprovalWait(d: Deps, ref: IntentRef) {
  await setTaskStatus(d.db, ref.ownerId, ref.taskId, 'waiting_approval');
  await pauseTaskWorkspaces(d, ref);
}

export async function checkApproval(d: Deps, ref: IntentRef): Promise<ApprovalCheck> {
  const intent = await getIntentForOwner(d.db, ref.ownerId, ref.intentId);
  if (intent.taskId !== ref.taskId) return { state: 'rejected' };
  return { state: await checkApprovalRow(d.db, ref.ownerId, ref.intentId) };
}

export async function resumeAfterApproval(d: Deps, ref: TaskRef) {
  await setTaskStatus(d.db, ref.ownerId, ref.taskId, 'running');
}

export async function recordApprovalOutcome(d: Deps, ref: IntentRef & { state: 'rejected' | 'expired' }) {
  if (ref.state === 'expired') {
    await expireIntent(d.db, ref.ownerId, ref.intentId);
    await emit(d, ref.ownerId, ref.taskId, 'approval.expired', `approval.expired:${ref.intentId}`, { intentId: ref.intentId });
    await result(d, ref, false, 'The approval request expired without a decision; the action was not performed.', 'approval expired');
  } else {
    await emit(d, ref.ownerId, ref.taskId, 'approval.decided', `approval.decided:${ref.intentId}`, { intentId: ref.intentId, decision: 'rejected' });
    await result(d, ref, false, 'The user rejected this action; it was not performed. Do not attempt it another way.', 'rejected by user');
  }
}

/**
 * Executes one approved external write exactly once. Never retried automatically (Activity has
 * maximumAttempts=1). Ambiguous failures are recorded as `unknown` and surfaced to the user.
 */
export async function executeApprovedAction(d: Deps, ref: IntentRef): Promise<ActionOutcome> {
  let begin;
  try {
    begin = await beginAttempt(d.db, ref.ownerId, ref.intentId, d.workerId);
  } catch (err) {
    if (err instanceof ApprovalError) {
      await result(d, ref, false, `Not performed: ${err.message}.`, `not performed (${err.code})`);
      return { state: 'skipped', summary: err.message };
    }
    throw err;
  }
  if (begin.kind === 'already') {
    const state = begin.state === 'confirmed' || begin.state === 'failed' ? begin.state : 'unknown';
    return { state, summary: `already ${begin.state}` };
  }
  const intent = begin.intent;
  if (intent.taskId !== ref.taskId) throw new ApprovalError('not_approved', 'intent does not belong to this task');
  await emit(d, ref.ownerId, ref.taskId, 'action.attempted', `action.attempted:${intent.id}`, { intentId: intent.id, tool: intent.toolSlug });

  const fail = async (reason: string): Promise<ActionOutcome> => {
    await finishAttempt(d.db, ref.ownerId, intent.id, 'failed', { error: reason });
    await emit(d, ref.ownerId, ref.taskId, 'action.failed', `action.failed:${intent.id}`, { intentId: intent.id, reason });
    await result(d, ref, false, `The action failed and was not performed: ${reason}`, 'action failed');
    return { state: 'failed', summary: reason };
  };

  const spec = [...toolRegistry(d).values()].find((s) => isConnectorSpec(s) && s.composioSlug === intent.toolSlug);
  if (!spec || !isConnectorSpec(spec) || !spec.toolkit) return fail('tool is no longer in the verified catalogue');
  if (spec.version !== intent.toolVersion) return fail(`tool version changed (${intent.toolVersion} -> ${spec.version}); a new approval is required`);
  if (!intent.connectedAccountId) return fail('no bound account');
  const conn = await getConnectionForOwner(d.db, ref.ownerId, intent.connectedAccountId);
  if (conn.status !== 'active' || conn.toolkit !== spec.toolkit || !conn.composioConnectedAccountId) return fail('the bound account is no longer active');

  let res;
  try {
    res = await d.connector().execute(conn.composioUserId, spec.toolkit as Toolkit, conn.composioConnectedAccountId, intent.toolSlug, intent.args as Record<string, unknown>, AbortSignal.timeout(90_000));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finishAttempt(d.db, ref.ownerId, intent.id, 'unknown', { error: msg });
    await emit(d, ref.ownerId, ref.taskId, 'action.unknown_outcome', `action.unknown:${intent.id}`, { intentId: intent.id, tool: intent.toolSlug });
    await result(d, ref, false, UNKNOWN_TEXT, 'outcome unknown');
    return { state: 'unknown', summary: 'outcome unknown' };
  }
  await recordUsage(d.db, { ownerId: ref.ownerId, taskId: ref.taskId, kind: 'composio', provider: 'composio', model: intent.toolSlug, requestId: res.logId, dedupeKey: `composio:action:${intent.id}`, quantity: '1 tool call', costNanos: null, costStatus: 'unknown' });
  if (!res.ok) return fail(`provider reported an error: ${(res.error ?? 'unknown').slice(0, 300)}`);

  const receipt = { logId: res.logId, data: JSON.stringify(res.data ?? null).slice(0, 2000) };
  await finishAttempt(d.db, ref.ownerId, intent.id, 'confirmed', { receipt });
  await emit(d, ref.ownerId, ref.taskId, 'action.confirmed', `action.confirmed:${intent.id}`, { intentId: intent.id, tool: intent.toolSlug, logId: res.logId });
  await result(d, ref, true, `Done (${intent.toolSlug}). Provider receipt: ${receipt.data}`, 'confirmed');
  return { state: 'confirmed', summary: 'confirmed' };
}

/** Called by the workflow when executeApprovedAction itself failed (crash, timeout). */
export async function reconcileAttempt(d: Deps, ref: IntentRef & { error: string }): Promise<ActionOutcome> {
  const attempt = await getAttempt(d.db, ref.ownerId, ref.intentId);
  if (!attempt) {
    await result(d, ref, false, `Not performed: ${ref.error.slice(0, 300)}`, 'not performed');
    return { state: 'skipped', summary: 'never attempted' };
  }
  if (attempt.state === 'in_flight') {
    await finishAttempt(d.db, ref.ownerId, ref.intentId, 'unknown', { error: `worker interrupted: ${ref.error}` });
    await emit(d, ref.ownerId, ref.taskId, 'action.unknown_outcome', `action.unknown:${ref.intentId}`, { intentId: ref.intentId });
    await result(d, ref, false, UNKNOWN_TEXT, 'outcome unknown');
    return { state: 'unknown', summary: 'outcome unknown' };
  }
  return { state: attempt.state as ActionOutcome['state'], summary: `already ${attempt.state}` };
}
