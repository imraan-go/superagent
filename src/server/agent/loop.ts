import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { approvals, runSteps, runs, usageEvents } from "@/server/db/schema";
import { getToolCatalog } from "@/server/lhos/catalog";
import { lhos, resultImages, resultText } from "@/server/lhos/client";
import { classifyFailure, backoffMs, MAX_WAKING_RETRIES } from "@/server/lhos/retryable";
import { getAdapter } from "@/server/models";
import { ZERO_USAGE, addUsage, costToNumeric, costUsd } from "@/server/models/pricing";
import type { AdapterMessage, AdapterTool, TokenUsage } from "@/server/models/types";
import { appendMessage } from "@/server/chat/repo";
import { AppError, toAppError } from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";
import { activityLabel } from "@/lib/activity";
import type { MessagePart } from "@/lib/messages";
import { filterTools, resolveAllowlist } from "./allowlist";
import { notifyUsage } from "@/server/usage/live";
import { requiresApproval } from "./policy";
import { getSection } from "@/server/settings/store";
import { emit, finishRun, startRun } from "./registry";
import { buildContext, toAdapterParts } from "./context";

/**
 * Agent loop v1 (docs/skills/skill-agent-loop.md): plan → act → observe, with
 * every step persisted and streamed.
 *
 * Runs detached from the request that started it. The HTTP POST returns a
 * `runId` immediately and the client attaches to `/api/runs/{id}/events`, so
 * closing the tab never kills a run.
 */
/** Fallbacks only — the live values come from Settings → Agent each run. */
const MAX_STEPS = 40;
const MAX_COST_USD = 2;
const MAX_TOKENS = 4_096;
/** Text deltas are coalesced to this cadence — imperceptible, ~12 frames/s. */
const TOKEN_FLUSH_MS = 80;
/** Oversized tool output is trimmed for the model and the UI alike. */
const RESULT_LIMIT = 8_000;

export interface StartRunInput {
  chatId: string;
  userId: string;
  modelId: string;
}

export async function startAgentRun(input: StartRunInput): Promise<string> {
  const [run] = await db
    .insert(runs)
    .values({ chatId: input.chatId, model: input.modelId })
    .returning({ id: runs.id });

  if (!run) throw new AppError("internal", "Could not start the run.");

  const controller = startRun(run.id);

  // Deliberately not awaited: the loop outlives this request.
  void execute({ ...input, runId: run.id, signal: controller.signal }).catch(
    (err: unknown) => {
      logger.error("agent", { runId: run.id, msg: "loop crashed", detail: String(err) });
    },
  );

  return run.id;
}

interface ExecuteInput extends StartRunInput {
  runId: string;
  signal: AbortSignal;
}

async function execute(input: ExecuteInput): Promise<void> {
  const { runId, chatId, userId, modelId, signal } = input;
  let stepIdx = 0;
  let total: TokenUsage = ZERO_USAGE;
  let cost = 0;

  try {
    const { adapter, model } = await getAdapter(modelId);
    emit(runId, { type: "run_started", runId, chatId, model: model.label });

    // Settings are read once per run: a change applies to the next run, never
    // half-way through one.
    const [agentSettings, approvalSettings] = await Promise.all([
      getSection("agent"),
      getSection("approvals"),
    ]);
    const maxSteps = agentSettings.maxSteps;
    const maxCostUsd = agentSettings.maxCostUsdPerRun;

    const tools = model.tools ? await loadTools(resolveAllowlist(agentSettings.toolAllowlist)) : [];
    const context = await buildContext({
      chatId,
      userId,
      model,
      systemPrompt: agentSettings.systemPrompt,
    });
    const messages: AdapterMessage[] = context.messages;

    for (let turn = 0; turn < maxSteps; turn += 1) {
      if (signal.aborted) return void (await endRun(runId, chatId, "cancelled"));

      let text = "";
      const toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> =
        [];
      let flushedAt = Date.now();
      let buffered = "";

      /**
       * Emits any buffered text. Called before every non-token event so the
       * transcript order is exactly the order the model produced, rather than
       * text appearing after the usage or step event that followed it.
       */
      const flushTokens = () => {
        if (!buffered) return;
        emit(runId, { type: "token", text: buffered });
        buffered = "";
        flushedAt = Date.now();
      };

      for await (const event of adapter.stream({
        model: model.model,
        system: context.system,
        messages,
        tools,
        maxTokens: MAX_TOKENS,
        signal,
      })) {
        switch (event.type) {
          case "text": {
            text += event.text;
            buffered += event.text;
            if (Date.now() - flushedAt >= TOKEN_FLUSH_MS) flushTokens();
            break;
          }
          case "tool_call":
            toolCalls.push(event);
            break;
          case "usage": {
            flushTokens();
            total = addUsage(total, event.usage);
            const turnCost = costUsd(event.usage, model.price);
            cost += turnCost;
            await recordUsage({
              chatId,
              runId,
              model,
              usage: event.usage,
              costUsd: turnCost,
            });
            emit(runId, {
              type: "usage",
              tokensIn: total.in,
              tokensOut: total.out,
              cached: total.cached,
              costUsd: Number(cost.toFixed(6)),
            });
            break;
          }
          case "stop":
            flushTokens();
            if (event.reason === "aborted") {
              return void (await endRun(runId, chatId, "cancelled"));
            }
            break;
        }
      }

      flushTokens();

      // Persist the assistant turn before acting on it, so a crash mid-tool
      // still leaves the transcript coherent.
      const assistantParts: MessagePart[] = [
        ...(text.trim() ? [{ type: "text" as const, text }] : []),
        ...toolCalls.map((c) => ({
          type: "tool_use" as const,
          id: c.id,
          name: c.name,
          args: c.args,
        })),
      ];

      if (assistantParts.length > 0) {
        const saved = await appendMessage(chatId, userId, {
          role: "assistant",
          content: assistantParts,
          model: model.id,
          runId,
        });
        emit(runId, { type: "message", message: saved });
        messages.push({ role: "assistant", content: toAdapterParts(assistantParts) });
      }

      if (toolCalls.length === 0) {
        return void (await endRun(runId, chatId, "done"));
      }

      if (cost > maxCostUsd) {
        throw new AppError(
          "budget_exceeded",
          `This run reached its $${maxCostUsd.toFixed(2)} cap. Raise it in Settings → Agent to continue.`,
        );
      }

      const resultParts: MessagePart[] = [];

      for (const call of toolCalls) {
        const gate = requiresApproval(call.name, {
          extraPatterns: approvalSettings.checkpointPatterns,
        });
        if (gate.required) {
          await checkpoint({ runId, chatId, stepIdx, call, reason: gate.reason });
          return;
        }

        const step = await observeTool({ runId, stepIdx, call, signal });
        stepIdx += 1;
        resultParts.push(step);
      }

      const saved = await appendMessage(chatId, userId, {
        role: "tool",
        content: resultParts,
        runId,
      });
      emit(runId, { type: "message", message: saved });
      messages.push({ role: "user", content: toAdapterParts(resultParts) });
    }

    throw new AppError(
      "internal",
      `This run hit the ${maxSteps}-step limit without finishing.`,
    );
  } catch (err) {
    if (signal.aborted) return void (await endRun(runId, chatId, "cancelled"));

    const appErr = toAppError(err);
    logger.warn("agent", { runId, code: appErr.code, message: appErr.message });

    await db
      .update(runs)
      .set({ status: "error", error: appErr.message, endedAt: new Date() })
      .where(eq(runs.id, runId));

    emit(runId, { type: "error", code: appErr.code, message: appErr.message });
    finishRun(runId);
  }
}

/** Runs one tool, persisting the step and streaming both of its events. */
async function observeTool(args: {
  runId: string;
  stepIdx: number;
  call: { id: string; name: string; args: Record<string, unknown> };
  signal: AbortSignal;
}): Promise<MessagePart> {
  const { runId, stepIdx, call, signal } = args;
  const label = activityLabel(call.name);

  await db.insert(runSteps).values({
    runId,
    idx: stepIdx,
    type: "tool",
    toolName: call.name,
    args: call.args,
  });

  emit(runId, {
    type: "step",
    step: { idx: stepIdx, type: "tool", toolName: call.name, label, ok: null, ms: null },
  });

  for (let attempt = 0; ; attempt += 1) {
    try {
      const result = await lhos.callTool(call.name, call.args, { signal });
      const text = truncate(resultText(result.result), RESULT_LIMIT);
      const images = resultImages(result.result);

      await db
        .update(runSteps)
        .set({ result: { text }, ok: result.ok, ms: result.ms })
        .where(and(eq(runSteps.runId, runId), eq(runSteps.idx, stepIdx)));

      emit(runId, {
        type: "step_done",
        step: {
          idx: stepIdx,
          type: "tool",
          toolName: call.name,
          label,
          ok: result.ok,
          ms: result.ms,
          preview: text.slice(0, 280),
        },
      });

      // Images are referenced by file id (ADR-07). The files write lands in
      // Phase 2, so v1 tells the model a screenshot exists without inlining it.
      const note = images.length > 0 ? `\n[${images.length} screenshot(s) captured]` : "";

      return {
        type: "tool_result",
        toolUseId: call.id,
        name: call.name,
        ok: result.ok,
        ms: result.ms,
        text: (text || (result.ok ? "(no output)" : "(failed)")) + note,
        images: [],
      } satisfies MessagePart;
    } catch (err) {
      const appErr = toAppError(err);
      // An abort surfaces here as a transport failure; it is the owner's doing,
      // not an error, and the transcript should say so.
      const message = signal.aborted ? "Cancelled before this finished." : appErr.message;
      const kind = classifyFailure({ status: appErr.status, message: appErr.message });

      if (kind === "waking" && attempt < MAX_WAKING_RETRIES && !signal.aborted) {
        const wait = backoffMs(kind, attempt);
        emit(runId, {
          type: "waiting",
          reason: "The agent computer is waking up.",
          retryInMs: wait,
        });
        await sleep(wait, signal);
        continue;
      }

      await db
        .update(runSteps)
        .set({ result: { error: message }, ok: false })
        .where(and(eq(runSteps.runId, runId), eq(runSteps.idx, stepIdx)));

      emit(runId, {
        type: "step_done",
        step: {
          idx: stepIdx,
          type: "tool",
          toolName: call.name,
          label,
          ok: false,
          ms: null,
          preview: message,
        },
      });

      // A failed tool is information for the model, not the end of the run.
      return {
        type: "tool_result",
        toolUseId: call.id,
        name: call.name,
        ok: false,
        text: message,
        images: [],
      };
    }
  }
}

/**
 * Pauses the run for the owner's decision. The loop *stops* here — it does not
 * poll, does not proceed, and cannot approve itself (rule 00-project).
 */
async function checkpoint(args: {
  runId: string;
  chatId: string;
  stepIdx: number;
  call: { id: string; name: string; args: Record<string, unknown> };
  reason: string | null;
}): Promise<void> {
  const { runId, chatId, stepIdx, call, reason } = args;

  await db.insert(runSteps).values({
    runId,
    idx: stepIdx,
    type: "approval",
    toolName: call.name,
    args: call.args,
  });

  await db.insert(approvals).values({
    runId,
    kind: "confirm",
    prompt: `Run \`${call.name}\`? ${reason ?? ""}`.trim(),
    status: "pending",
  });

  await db
    .update(runs)
    .set({ status: "paused_approval" })
    .where(eq(runs.id, runId));

  emit(runId, {
    type: "approval_required",
    stepIdx,
    tool: call.name,
    reason: reason ?? "This action needs your approval.",
    args: call.args,
  });

  emit(runId, { type: "done", status: "paused_approval" });
  finishRun(runId);
  logger.info("agent", { runId, chatId, msg: "paused for approval", tool: call.name });
}

async function endRun(
  runId: string,
  chatId: string,
  status: "done" | "cancelled",
): Promise<void> {
  await db
    .update(runs)
    .set({ status, endedAt: new Date() })
    .where(eq(runs.id, runId));

  emit(runId, { type: "done", status });
  finishRun(runId);
  logger.info("agent", { runId, chatId, status });
}

async function loadTools(allowlist: readonly string[]): Promise<AdapterTool[]> {
  const catalog = await getToolCatalog();
  return filterTools(catalog, allowlist).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.input_schema,
  }));
}

async function recordUsage(args: {
  chatId: string;
  runId: string;
  model: { id: string; vendor: string; model: string };
  usage: TokenUsage;
  costUsd: number;
}): Promise<void> {
  await db.insert(usageEvents).values({
    vendor: args.model.vendor,
    model: args.model.id,
    chatId: args.chatId,
    runId: args.runId,
    tokensIn: args.usage.in,
    tokensOut: args.usage.out,
    tokensCached: args.usage.cached,
    costUsd: costToNumeric(args.costUsd),
    purpose: "chat",
  });
  notifyUsage(args.chatId);
}

function truncate(text: string, limit: number): string {
  return text.length <= limit
    ? text
    : `${text.slice(0, limit)}\n…[trimmed ${text.length - limit} characters]`;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

export { MAX_COST_USD, MAX_STEPS };
