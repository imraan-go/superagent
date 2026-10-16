import { toolResultMessage } from '@superagent/agent';
import type { ProposalVerdict, QuestionCheck, QuestionRef, ToolRef } from '@superagent/contracts/workflow';
import {
  CONFIRM_OPTIONS,
  appendMessage,
  createQuestion,
  describeAnswer,
  describeSpec,
  getQuestionForOwner,
  getScheduleForOwner,
  getTaskForOwner,
  getToolCall,
  setQuestionStatus,
  setTaskStatus,
  setToolCallStatus,
} from '@superagent/db';
import { emit, type Deps } from './deps';
import { pauseTaskWorkspaces } from './lifecycle';

/** Questions wait as long as approvals do (APPROVAL_EXPIRY_HOURS). */
function expiryMs(d: Deps) {
  return d.env.APPROVAL_EXPIRY_HOURS * 3_600_000;
}

async function confirmPrompt(d: Deps, ownerId: string, toolName: string, input: Record<string, unknown>, timezone: string | null): Promise<string> {
  if (toolName === 'schedule_create') {
    const when = input.cron ? `on cron \`${String(input.cron)}\`` : `every ${String(input.everyMinutes)} minutes`;
    const tz = (input.timezone as string | undefined) ?? timezone ?? 'UTC';
    return `Create the routine “${String(input.name)}”, running ${when} (${tz})? Each run will: ${String(input.prompt)}`;
  }
  const verb = toolName.replace('schedule_', '');
  try {
    const s = await getScheduleForOwner(d.db, ownerId, String(input.id));
    return `${verb[0]!.toUpperCase()}${verb.slice(1)} the routine “${s.name}” (${describeSpec(s.spec as never)})?`;
  } catch {
    return `${verb[0]!.toUpperCase()}${verb.slice(1)} routine ${String(input.id)}?`;
  }
}

/**
 * Called from evaluateProposal once policy allowed the call. `ask_user` always waits for the
 * user; a confirm-gated tool waits for an explicit Yes before it may run.
 */
export async function openQuestion(d: Deps, ref: ToolRef, toolName: string, input: Record<string, unknown>, gate: boolean): Promise<ProposalVerdict | null> {
  const task = await getTaskForOwner(d.db, ref.ownerId, ref.taskId);
  const ask = gate
    ? { kind: 'confirm', prompt: await confirmPrompt(d, ref.ownerId, toolName, input, task.timezone), options: CONFIRM_OPTIONS }
    : {
        kind: input.kind as string,
        prompt: input.question as string,
        options: input.kind === 'confirm' ? CONFIRM_OPTIONS : ((input.options as Array<{ id: string; label: string }> | undefined) ?? []),
      };
  // A choice question with no real choices would stall the run; the caller denies it so the model rephrases.
  if ((ask.kind === 'single' || ask.kind === 'multi') && ask.options.length < 2) return null;
  const q = await createQuestion(d.db, {
    ownerId: ref.ownerId,
    taskId: ref.taskId,
    chatId: task.chatId,
    toolCallId: ref.toolCallId,
    kind: ask.kind,
    prompt: ask.prompt,
    options: ask.options,
    gate,
    expiresAt: new Date(Date.now() + expiryMs(d)),
  });
  await setToolCallStatus(d.db, ref.ownerId, ref.toolCallId, 'awaiting_answer');
  return { verdict: 'needs_answer', toolCallId: ref.toolCallId, questionId: q.id, expiresAtMs: q.expiresAt.getTime(), gate };
}

export async function prepareForQuestionWait(d: Deps, ref: QuestionRef) {
  const q = await getQuestionForOwner(d.db, ref.ownerId, ref.questionId);
  await setTaskStatus(d.db, ref.ownerId, ref.taskId, 'waiting_approval');
  await emit(d, ref.ownerId, ref.taskId, 'question.asked', `question.asked:${q.id}`, {
    questionId: q.id,
    kind: q.kind,
    prompt: q.prompt,
    options: q.options,
    gate: q.gate,
    expiresAt: q.expiresAt.toISOString(),
  });
  await pauseTaskWorkspaces(d, ref);
}

export async function checkQuestion(d: Deps, ref: QuestionRef): Promise<QuestionCheck> {
  const q = await getQuestionForOwner(d.db, ref.ownerId, ref.questionId);
  if (q.taskId !== ref.taskId) return { state: 'cancelled' };
  if (q.status === 'answered') return { state: 'answered', confirmed: q.answer?.choices.includes('yes') ?? false };
  if (q.status === 'expired' || q.expiresAt.getTime() <= Date.now()) return { state: 'expired' };
  if (q.status === 'cancelled') return { state: 'cancelled' };
  return { state: 'pending' };
}

export async function recordQuestionOutcome(d: Deps, ref: QuestionRef & { gate: boolean; state: 'answered' | 'expired' | 'cancelled' }): Promise<{ runGatedTool: boolean }> {
  const q = await getQuestionForOwner(d.db, ref.ownerId, ref.questionId);
  const tc = await getToolCall(d.db, ref.ownerId, ref.toolCallId);
  await setTaskStatus(d.db, ref.ownerId, ref.taskId, 'running');
  if (ref.state !== 'answered') await setQuestionStatus(d.db, ref.ownerId, q.id, ref.state);
  await emit(d, ref.ownerId, ref.taskId, ref.state === 'answered' ? 'question.answered' : 'question.expired', `question.${ref.state}:${q.id}`, {
    questionId: q.id,
    ...(ref.state === 'answered' ? { answer: q.answer } : {}),
  });

  const confirmed = ref.state === 'answered' && (q.answer?.choices.includes('yes') ?? false);
  if (ref.gate && confirmed) {
    // The Yes re-allows exactly this call; executeTool then runs it and writes its result.
    await setToolCallStatus(d.db, ref.ownerId, ref.toolCallId, 'allowed');
    return { runGatedTool: true };
  }

  const text =
    ref.state !== 'answered'
      ? 'The user did not answer in time; nothing was done. Continue without it or stop and say so.'
      : ref.gate
        ? `The user declined (${describeAnswer(q) || 'No'}); this was NOT done. Do not attempt it another way.`
        : `The user answered.\n${describeAnswer(q)}`;
  await appendMessage(d.db, {
    ownerId: ref.ownerId,
    taskId: ref.taskId,
    step: tc.step,
    kind: 'tool_result',
    dedupeKey: `tool:${ref.toolCallId}`,
    content: toolResultMessage(tc.providerToolCallId, tc.toolName, ref.state === 'answered' && !ref.gate ? { type: 'text', value: text } : { type: 'error-text', value: text }),
  });
  await setToolCallStatus(d.db, ref.ownerId, ref.toolCallId, ref.state === 'answered' && !ref.gate ? 'done' : 'failed', ref.state === 'answered' ? describeAnswer(q).slice(0, 200) : 'no answer');
  return { runGatedTool: false };
}
