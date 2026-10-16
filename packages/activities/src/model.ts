import { and, asc, eq } from 'drizzle-orm';
import type { ModelMessage } from 'ai';
import { Context } from '@temporalio/activity';
import { PartialOutputError, SYSTEM_PROMPT, approxTokens, buildContext, checkModel, estimateMaxCostNanos, toModelMessages, toolResultMessage, type DecisionUsage } from '@superagent/agent';
import type { DecisionResult, TaskRef } from '@superagent/contracts/workflow';
import {
  BudgetExceededError,
  appendMessage,
  getArtifactForOwner,
  getBudgetLimits,
  getMessageByDedupe,
  getPreference,
  getTaskForOwner,
  listConnections,
  listMemories,
  listMessages,
  recordUsage,
  reserveBudget,
  schema,
  setTaskStatus,
  settleReservation,
  upsertToolCalls,
} from '@superagent/db';
import { nanosToUsd, usdToNanos } from '@superagent/observability';
import { emit, type Deps } from './deps';
import { exposedTools, toolRegistry } from './registry';

export class ModelConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelConfigError';
  }
}

/** Extra input allowance per screenshot sent to the model (vision tokens are not in our char estimate). */
const IMAGE_TOKEN_ALLOWANCE = 1_600;

function attemptNumber(): number {
  try {
    return Context.current().info.attempt;
  } catch {
    return 1;
  }
}

function abortSignal(): AbortSignal | undefined {
  try {
    return Context.current().cancellationSignal;
  } catch {
    return undefined;
  }
}

export function budgetDefaults(d: Pick<Deps, 'env'>) {
  return {
    perRunNanos: d.env.MAX_COST_PER_RUN ? usdToNanos(d.env.MAX_COST_PER_RUN) : null,
    monthlyNanos: d.env.MONTHLY_COST_LIMIT ? usdToNanos(d.env.MONTHLY_COST_LIMIT) : null,
  };
}

async function replayDecision(d: Deps, ref: TaskRef, step: number): Promise<DecisionResult> {
  const rows = await d.db
    .select()
    .from(schema.toolCalls)
    .where(and(eq(schema.toolCalls.taskId, ref.taskId), eq(schema.toolCalls.ownerId, ref.ownerId), eq(schema.toolCalls.step, step)))
    .orderBy(asc(schema.toolCalls.createdAt));
  if (!rows.length) return { kind: 'final', step };
  return { kind: 'tools', step, proposals: rows.filter((r) => r.status !== 'invalid').map((r) => ({ toolCallId: r.id, toolName: r.toolName })) };
}

export async function modelDecision(d: Deps, ref: TaskRef & { step: number }): Promise<DecisionResult> {
  const { taskId, ownerId, step } = ref;
  const task = await getTaskForOwner(d.db, ownerId, taskId);

  // Idempotency: a retried/replayed Activity for an already-recorded step never calls the model again.
  if (await getMessageByDedupe(d.db, ownerId, taskId, `assistant:${step}`)) return replayDecision(d, ref, step);

  const env = d.env;
  const reg = toolRegistry(d);
  const conns = await listConnections(d.db, ownerId);
  const activeToolkits = new Set(conns.filter((c) => c.status === 'active').map((c) => c.toolkit));
  const tools = exposedTools(reg, { configured: d.configured(), activeToolkits, readOnly: task.readOnly, allowedDomains: task.allowedDomains, scheduled: task.origin === 'schedule', capabilities: task.capabilities });

  const rows = await listMessages(d.db, ownerId, taskId);
  const hasImages = rows.some((r) => JSON.stringify(r.content).includes('"artifact-image"'));
  const usesBrowser = tools.some((t) => t.executor === 'browser');
  // A model picked in the composer wins when the installation allows it; checkModel below still
  // validates capabilities, so an unsuitable pick fails loudly instead of silently degrading.
  const picked = task.model && d.allowlist().includes(task.model) ? task.model : null;
  const modelId = picked ?? (usesBrowser && env.AI_MODEL_BROWSER ? env.AI_MODEL_BROWSER : env.AI_MODEL_PRIMARY);
  const catalog = await d.catalog();
  const check = checkModel(catalog, modelId, d.allowlist(), usesBrowser || hasImages ? ['tool-use', 'vision'] : ['tool-use']);
  if (!check.ok || !check.entry) throw new ModelConfigError(`model ${check.modelId} rejected: ${check.problems.join('; ')}`);

  const messages = await toModelMessages(
    rows.map((r) => ({ kind: r.kind as 'user' | 'assistant' | 'tool_result', content: r.content })),
    async (artifactId) => {
      try {
        const a = await getArtifactForOwner(d.db, ownerId, artifactId);
        const obj = await d.store().get(a.objectKey);
        const chunks: Buffer[] = [];
        for await (const c of obj.stream) chunks.push(Buffer.from(c as Uint8Array));
        return { base64: Buffer.concat(chunks).toString('base64'), mediaType: a.contentType };
      } catch {
        return null;
      }
    },
  );
  const memories = await listMemories(d.db, ownerId);
  const agentPrefs = await getPreference(d.db, ownerId, 'agent');
  const context = buildContext({
    nowIso: new Date().toISOString(),
    timezone: task.timezone,
    taskTitle: task.title,
    allowedDomains: task.allowedDomains,
    readOnly: task.readOnly,
    memories: memories.map((m) => ({ id: m.id, content: m.content })),
    connectedToolkits: [...activeToolkits],
    remainingDecisions: Math.max(0, env.MAX_MODEL_DECISIONS_PER_RUN - step),
    userInstructions: typeof agentPrefs.systemPrompt === 'string' ? agentPrefs.systemPrompt : undefined,
  });

  const toolSchemas = tools.map((t) => ({ n: t.name, d: t.description, s: JSON.stringify(t.schema.toJSONSchema?.() ?? {}) }));
  const approx = approxTokens(SYSTEM_PROMPT, context, messages, toolSchemas) + (hasImages ? IMAGE_TOKEN_ALLOWANCE : 0);
  const surcharge = env.AI_GATEWAY_REPORTING_TAGS ? '0.00015' : '0';
  const estimate = estimateMaxCostNanos(check.entry, approx, env.AI_MAX_OUTPUT_TOKENS, surcharge);
  const reservationKey = `model:${taskId}:${step}:${attemptNumber()}`;
  try {
    await reserveBudget(d.db, { ownerId, taskId, dedupeKey: reservationKey, amountNanos: estimate, limits: await getBudgetLimits(d.db, ownerId, budgetDefaults(d)) });
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      await emit(d, ownerId, taskId, 'budget.blocked', `budget.blocked:${step}`, { step, estimateUsd: nanosToUsd(estimate), reason: err.message });
      return { kind: 'error', step, reason: `Budget limit: ${err.message}` };
    }
    throw err;
  }

  const record = async (usage: DecisionUsage, finishReason: string) => {
    await settleReservation(d.db, reservationKey, usage.costNanos);
    await recordUsage(d.db, {
      ownerId,
      taskId,
      kind: 'model',
      provider: 'vercel-ai-gateway',
      model: modelId!,
      requestId: usage.generationId ?? usage.requestId,
      dedupeKey: reservationKey,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      costNanos: usage.costNanos ?? estimate,
      costStatus: usage.costNanos !== null ? 'measured' : 'estimated',
      metadata: {
        finishReason,
        generationId: usage.generationId,
        providerRequestId: usage.requestId,
        resolvedProvider: usage.resolvedProvider,
        providerAttempts: usage.providerAttempts,
        responseModelId: usage.responseModelId,
        estimateUsd: nanosToUsd(estimate),
      },
    });
  };

  let out;
  try {
    out = await d.model().decide({ modelId: modelId!, system: SYSTEM_PROMPT, context, messages, tools, maxOutputTokens: env.AI_MAX_OUTPUT_TOKENS, endUserId: ownerId, abortSignal: abortSignal() });
  } catch (err) {
    if (err instanceof PartialOutputError) {
      await record(err.usage, 'partial');
      await emit(d, ownerId, taskId, 'model.decision', `model.decision:${step}`, { step, outcome: 'rejected_partial', reason: err.message });
      return { kind: 'error', step, reason: `Model output rejected: ${err.message}` };
    }
    // The request may or may not have been billed: keep the reservation charged at its estimate.
    await settleReservation(d.db, reservationKey, null);
    throw err;
  }
  await record(out.usage, out.finishReason);

  for (const [i, m] of out.responseMessages.entries()) {
    await appendMessage(d.db, { ownerId, taskId, step, kind: 'assistant', dedupeKey: i === 0 ? `assistant:${step}` : `assistant:${step}:${i}`, content: m });
  }
  if (out.responseMessages.length === 0) {
    await appendMessage(d.db, { ownerId, taskId, step, kind: 'assistant', dedupeKey: `assistant:${step}`, content: { role: 'assistant', content: out.text } satisfies ModelMessage });
  }

  await upsertToolCalls(
    d.db,
    out.calls.map((c) => ({
      id: `${taskId}:${c.toolCallId}`,
      taskId,
      ownerId,
      step,
      providerToolCallId: c.toolCallId,
      toolName: c.toolName,
      input: c.input as object,
      status: c.valid ? 'proposed' : 'invalid',
      resultSummary: c.valid ? null : `invalid arguments: ${c.error}`,
    })),
  );
  for (const c of out.calls.filter((x) => !x.valid)) {
    await appendMessage(d.db, {
      ownerId,
      taskId,
      step,
      kind: 'tool_result',
      dedupeKey: `tool:${taskId}:${c.toolCallId}`,
      content: toolResultMessage(c.toolCallId, c.toolName, { type: 'error-text', value: `Tool call rejected by the application: ${c.error}. Fix the arguments or choose another approach.` }),
    });
  }
  await emit(d, ownerId, taskId, 'model.decision', `model.decision:${step}`, {
    step,
    model: modelId,
    finishReason: out.finishReason,
    tools: out.calls.map((c) => ({ name: c.toolName, valid: c.valid })),
    inputTokens: out.usage.inputTokens,
    outputTokens: out.usage.outputTokens,
    cacheReadTokens: out.usage.cacheReadTokens,
    costUsd: out.usage.costNanos !== null ? nanosToUsd(out.usage.costNanos) : null,
    costStatus: out.usage.costNanos !== null ? 'measured' : 'estimated',
  });

  if (out.calls.length === 0) {
    await setTaskStatus(d.db, ownerId, taskId, 'running', { resultSummary: out.text.slice(0, 8000) });
    return { kind: 'final', step };
  }
  return { kind: 'tools', step, proposals: out.calls.filter((c) => c.valid).map((c) => ({ toolCallId: `${taskId}:${c.toolCallId}`, toolName: c.toolName })) };
}
