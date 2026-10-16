import { randomUUID } from 'node:crypto';
import { Context, CancelledFailure } from '@temporalio/activity';
import type { Sandbox } from 'e2b';
import { toolResultMessage } from '@superagent/agent';
import type { ProposalVerdict, ToolExecutionResult, ToolRef } from '@superagent/contracts/workflow';
import {
  NotFoundError,
  activeConnection,
  appendMessage,
  createIntent,
  createMemory,
  getBudgetLimits,
  getTaskForOwner,
  getToolCall,
  insertArtifact,
  recordUsage,
  reserveBudget,
  setTaskStatus,
  setToolCallStatus,
  settleReservation,
  updateConnection,
  createScheduleWithOutbox,
  describeSpec,
  listSchedules,
  transitionSchedule,
  type ScheduleTransition,
} from '@superagent/db';
import { BrowserPolicyError, WorkspacePathError, chromeVersion, ensureController, readBytesForExport, readTextFile, runPython, writeNewFile } from '@superagent/execution';
import { priceTimes } from "@superagent/observability";
import { evaluateTool, safeArtifactName } from '@superagent/policy';
import { ScheduleSpecInput, isIanaTimezone } from '@superagent/contracts';
import { artifactKey } from '@superagent/storage';
import type { Toolkit } from '@superagent/connectors';
import { emit, taskScope, type Deps } from './deps';
import { budgetDefaults } from './model';
import { openQuestion } from './questions';
import { capabilityOfTool, isConnectorSpec, toolRegistry, type AnyToolSpec } from './registry';

type ToolOutput = { type: 'text'; value: string } | { type: 'error-text'; value: string } | { type: 'content'; value: unknown[] };
interface RunOutcome {
  ok: boolean;
  output: ToolOutput;
  summary: string;
}

const DOWNLOAD_TYPES = new Map([
  ['application/pdf', 'pdf'],
  ['text/csv', 'csv'],
  ['text/plain', 'txt'],
  ['application/json', 'json'],
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
]);
const TOOL_TIMEOUT_MS = 5 * 60_000;

function clip(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n)}…[truncated]` : s;
}

async function loadCall(d: Deps, ref: ToolRef) {
  const tc = await getToolCall(d.db, ref.ownerId, ref.toolCallId);
  if (tc.taskId !== ref.taskId) throw new NotFoundError('tool call');
  const spec = toolRegistry(d).get(tc.toolName);
  return { tc, spec };
}

async function writeResult(d: Deps, ref: ToolRef, tc: { step: number; providerToolCallId: string; toolName: string }, output: ToolOutput) {
  await appendMessage(d.db, {
    ownerId: ref.ownerId,
    taskId: ref.taskId,
    step: tc.step,
    kind: 'tool_result',
    dedupeKey: `tool:${ref.toolCallId}`,
    content: toolResultMessage(tc.providerToolCallId, tc.toolName, output),
  });
}

export async function recordToolOutcome(d: Deps, ref: ToolRef & { status: 'denied' | 'failed'; summary: string }) {
  const tc = await getToolCall(d.db, ref.ownerId, ref.toolCallId);
  await writeResult(d, ref, tc, { type: 'error-text', value: ref.summary });
  await setToolCallStatus(d.db, ref.ownerId, ref.toolCallId, ref.status, ref.summary);
  await emit(d, ref.ownerId, ref.taskId, ref.status === 'denied' ? 'tool.denied' : 'tool.failed', `tool.${ref.status}:${ref.toolCallId}`, { tool: tc.toolName, reason: ref.summary });
}

export async function evaluateProposal(d: Deps, ref: ToolRef & { readOnly: boolean }): Promise<ProposalVerdict> {
  const { tc, spec } = await loadCall(d, ref);
  const deny = async (reason: string): Promise<ProposalVerdict> => {
    await recordToolOutcome(d, { ...ref, status: 'denied', summary: `Denied by policy: ${reason}` });
    return { verdict: 'deny', toolCallId: ref.toolCallId, reason };
  };
  if (!spec) return deny(`unknown tool ${tc.toolName}`);
  if (tc.status === 'done' || tc.status === 'failed' || tc.status === 'denied') return { verdict: 'deny', toolCallId: ref.toolCallId, reason: `already ${tc.status}` };

  const parsed = spec.schema.safeParse(tc.input);
  if (!parsed.success) return deny('arguments failed validation');
  const task = await getTaskForOwner(d.db, ref.ownerId, ref.taskId);
  const readOnly = ref.readOnly || task.readOnly;
  if (spec.executor === 'browser' && task.allowedDomains.length === 0) return deny('this task has no approved browsing domains');

  if (spec.interactiveOnly && task.origin === 'schedule') return deny('routines cannot manage routines');
  const cap = capabilityOfTool(spec);
  if (task.capabilities?.length && cap && !task.capabilities.includes(cap)) return deny(`${cap} is switched off for this message`);

  const conn = isConnectorSpec(spec) && spec.toolkit ? await activeConnection(d.db, ref.ownerId, spec.toolkit) : undefined;
  const decision = evaluateTool(spec, { readOnly, configured: d.configured(), connectorActive: () => Boolean(conn) });
  if (decision.verdict === 'deny') return deny(decision.reason);
  if (decision.verdict === 'allow' && (spec.name === 'ask_user' || spec.confirm)) {
    const v = await openQuestion(d, ref, spec.name, parsed.data as Record<string, unknown>, spec.name !== 'ask_user');
    return v ?? deny('single/multi questions need at least two options; use kind "text" for a free reply');
  }
  if (decision.verdict === 'allow') {
    await setToolCallStatus(d.db, ref.ownerId, ref.toolCallId, 'allowed');
    return { verdict: 'allow', toolCallId: ref.toolCallId, executor: spec.executor };
  }

  // Exact-action approval: immutable, hash-bound intent created BEFORE any external write.
  if (!isConnectorSpec(spec) || !spec.composioSlug || !conn) return deny('approval-gated tool has no bound account');
  const args = parsed.data as Record<string, unknown>;
  const destination = Object.fromEntries(spec.destinationFields.map((f) => [f, args[f] ?? null]));
  const intent = await createIntent(d.db, {
    ownerId: ref.ownerId,
    taskId: ref.taskId,
    toolCallId: ref.toolCallId,
    toolSlug: spec.composioSlug,
    toolVersion: spec.version,
    connectedAccountId: conn.id,
    args,
    destination,
    attachments: [],
    expiryMs: d.env.APPROVAL_EXPIRY_HOURS * 3_600_000,
  });
  await setToolCallStatus(d.db, ref.ownerId, ref.toolCallId, 'awaiting_approval');
  await emit(d, ref.ownerId, ref.taskId, 'approval.requested', `approval.requested:${intent.id}`, {
    intentId: intent.id,
    tool: spec.composioSlug,
    toolkit: spec.toolkit,
    account: conn.accountLabel ?? conn.toolkit,
    expiresAt: intent.expiresAt.toISOString(),
  });
  return { verdict: 'needs_approval', toolCallId: ref.toolCallId, intentId: intent.id, expiresAtMs: intent.expiresAt.getTime() };
}

/** Heartbeats while running and turns Activity cancellation into a prompt rejection. */
async function supervised<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  let ctx: Context | undefined;
  try {
    ctx = Context.current();
  } catch {
    ctx = undefined;
  }
  if (!ctx) return fn(new AbortController().signal);
  const c = ctx;
  const iv = setInterval(() => c.heartbeat(), 10_000);
  try {
    return await Promise.race([
      fn(c.cancellationSignal),
      new Promise<never>((_, reject) => c.cancellationSignal.addEventListener('abort', () => reject(new CancelledFailure('activity cancelled')), { once: true })),
    ]);
  } finally {
    clearInterval(iv);
  }
}

async function storeArtifact(d: Deps, ref: ToolRef, name: string, contentType: string, bytes: Uint8Array, source: Record<string, unknown>) {
  if (bytes.byteLength > d.env.MAX_ARTIFACT_BYTES) throw new WorkspacePathError(`artifact exceeds ${d.env.MAX_ARTIFACT_BYTES} bytes`);
  const id = randomUUID();
  const safe = safeArtifactName(name);
  const key = artifactKey(ref.ownerId, ref.taskId, id, safe);
  const put = await d.store().put(key, bytes, contentType);
  const row = await insertArtifact(d.db, {
    id,
    ownerId: ref.ownerId,
    taskId: ref.taskId,
    name: safe,
    contentType,
    sizeBytes: bytes.byteLength,
    sha256: put.sha256,
    objectKey: key,
    // The producing tool call lets the chat attach screenshots to the right step.
    source: { ...source, toolCallId: ref.toolCallId },
    chatId: (await getTaskForOwner(d.db, ref.ownerId, ref.taskId)).chatId,
    expiresAt: new Date(Date.now() + d.env.TASK_RETENTION_DAYS * 86_400_000),
  });
  await emit(d, ref.ownerId, ref.taskId, 'artifact.created', `artifact.created:${row.id}`, { artifactId: row.id, name: row.name, contentType, sizeBytes: row.sizeBytes, sha256: row.sha256 });
  return row;
}

/** Sandbox time is only costed when the operator entered an explicit E2B rate; otherwise 'unknown'. */
async function withSandboxBudget<T>(d: Deps, ref: ToolRef, kind: 'code' | 'browser', fn: () => Promise<T>): Promise<T> {
  const rate = d.env.E2B_RATE_USD_PER_SECOND;
  const key = `e2b:${ref.toolCallId}`;
  if (rate) {
    const amount = priceTimes(rate, Math.ceil(TOOL_TIMEOUT_MS / 1000));
    await reserveBudget(d.db, { ownerId: ref.ownerId, taskId: ref.taskId, dedupeKey: key, amountNanos: amount, limits: await getBudgetLimits(d.db, ref.ownerId, budgetDefaults(d)) });
  }
  const started = Date.now();
  try {
    return await fn();
  } finally {
    const seconds = Math.ceil((Date.now() - started) / 1000);
    const cost = rate ? priceTimes(rate, seconds) : null;
    if (rate) await settleReservation(d.db, key, cost).catch(() => undefined);
    await recordUsage(d.db, {
      ownerId: ref.ownerId,
      taskId: ref.taskId,
      kind: 'e2b',
      provider: 'e2b',
      model: kind,
      dedupeKey: key,
      quantity: `${seconds} sandbox-seconds`,
      costNanos: cost,
      costStatus: cost !== null ? 'estimated' : 'unknown',
      rateVersion: rate ? `${rate}/s ${d.env.E2B_RATE_SOURCE ?? 'operator-entered'}` : null,
    }).catch(() => undefined);
  }
}

async function runWorkspaceTool(d: Deps, ref: ToolRef, name: string, input: Record<string, unknown>): Promise<RunOutcome> {
  return withSandboxBudget(d, ref, 'code', () =>
    d.workspaces().with(ref.ownerId, 'code', 'user', async (sbx: Sandbox, row) => {
      switch (name) {
        case 'workspace_write_file': {
          const r = await writeNewFile(sbx, input.path as string, input.content as string);
          return { ok: true, output: { type: 'text', value: `Created ${r.path} (${r.bytes} bytes).` }, summary: `created ${r.path}` };
        }
        case 'workspace_read_file': {
          const r = await readTextFile(sbx, input.path as string);
          return { ok: true, output: { type: 'text', value: r.text }, summary: `read ${r.path}` };
        }
        case 'workspace_run_python': {
          const r = await runPython(sbx, input.code as string, { timeoutMs: 120_000 });
          const text = `exit code: ${r.exitCode}${r.timedOut ? ' (timed out)' : ''}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`;
          return { ok: r.exitCode === 0, output: { type: 'text', value: text }, summary: `python exit ${r.exitCode} in ${r.durationMs}ms` };
        }
        case 'workspace_export_file': {
          const r = await readBytesForExport(sbx, input.path as string, d.env.MAX_ARTIFACT_BYTES);
          const name = r.path.split('/').at(-1) ?? 'file';
          const a = await storeArtifact(d, ref, name, r.contentType, r.bytes, { kind: 'workspace', path: r.path, workspaceId: row.id, sandboxId: sbx.sandboxId });
          return { ok: true, output: { type: 'text', value: `Exported ${r.path} as artifact ${a.id} (${a.name}, ${a.sizeBytes} bytes, sha256 ${a.sha256}).` }, summary: `exported ${a.name}` };
        }
        default:
          throw new Error(`unhandled workspace tool ${name}`);
      }
    }),
  );
}

async function runBrowserTool(d: Deps, ref: ToolRef, name: string, input: Record<string, unknown>, allowed: string[]): Promise<RunOutcome> {
  if (name === 'browser_stop') {
    await d.workspaces().kill(ref.ownerId, 'browser', ref.taskId);
    return { ok: true, output: { type: 'text', value: 'Browser closed.' }, summary: 'browser closed' };
  }
  return withSandboxBudget(d, ref, 'browser', () =>
    d.workspaces().with(ref.ownerId, 'browser', ref.taskId, async (sbx: Sandbox) => {
      await ensureController(sbx);
      const version = await chromeVersion(sbx).catch(() => 'unknown');
      await emit(d, ref.ownerId, ref.taskId, 'browser.started', `browser.started:${sbx.sandboxId}`, { browser: version, sandboxId: sbx.sandboxId });
      const b = d.browser;
      switch (name) {
        case 'browser_navigate': {
          const r = await b.navigate(sbx, input.url as string, allowed);
          return { ok: true, output: { type: 'text', value: `Opened ${r.url} (HTTP ${r.status ?? '?'}) — "${r.title ?? ''}". Use browser_read to see content.` }, summary: `navigated to ${r.url}` };
        }
        case 'browser_read': {
          const r = await b.read(sbx, allowed);
          const els = (r.elements ?? []).map((e) => `[${e.i}] <${e.tag}${e.type ? ` ${e.type}` : ''}> ${e.label}${e.href ? ` -> ${e.href}` : ''}`).join('\n');
          const text = `URL: ${r.url}\nTitle: ${r.title}\n\n[UNTRUSTED PAGE CONTENT START]\n${clip(r.text ?? '', 10_000)}\n[UNTRUSTED PAGE CONTENT END]\n\nInteractive elements:\n${clip(els, 4000)}`;
          return { ok: true, output: { type: 'text', value: text }, summary: `read ${r.url}` };
        }
        case 'browser_screenshot': {
          const r = await b.screenshot(sbx, allowed, Boolean(input.fullPage));
          const host = (() => {
            try {
              return new URL(r.url).hostname;
            } catch {
              return 'page';
            }
          })();
          const a = await storeArtifact(d, ref, `screenshot-${host}.png`, 'image/png', r.bytes, { kind: 'browser_screenshot', url: r.url, title: r.title, capturedAt: new Date().toISOString() });
          return {
            ok: true,
            output: { type: 'content', value: [{ type: 'text', text: `Screenshot of ${r.url} saved as artifact ${a.id} (${a.name}).` }, { type: 'artifact-image', artifactId: a.id }] },
            summary: `screenshot ${a.name}`,
          };
        }
        case 'browser_click': {
          const r = await b.click(sbx, allowed, input.element as number);
          return { ok: true, output: { type: 'text', value: `Clicked element ${input.element as number}. Now at ${r.url} — "${r.title ?? ''}".` }, summary: `clicked ${input.element as number}` };
        }
        case 'browser_type': {
          await b.type(sbx, allowed, input.element as number, input.text as string);
          return { ok: true, output: { type: 'text', value: `Typed into element ${input.element as number} (not submitted).` }, summary: `typed into ${input.element as number}` };
        }
        case 'browser_scroll': {
          const r = await b.scroll(sbx, allowed, input.direction as 'up' | 'down');
          return { ok: true, output: { type: 'text', value: `Scrolled ${input.direction as string} on ${r.url ?? 'page'}.` }, summary: `scrolled ${input.direction as string}` };
        }
        case 'browser_download': {
          const r = await b.download(sbx, allowed, input.url as string);
          const ext = DOWNLOAD_TYPES.get(r.contentType);
          if (!ext) throw new BrowserPolicyError(`content type ${r.contentType || 'unknown'} is not an allowed download type`);
          const base = (new URL(r.url).pathname.split('/').at(-1) || 'download').replace(/\.[A-Za-z0-9]+$/, '');
          const a = await storeArtifact(d, ref, `${base}.${ext}`, r.contentType, r.bytes, { kind: 'browser_download', url: r.url, downloadedAt: new Date().toISOString() });
          return { ok: true, output: { type: 'text', value: `Downloaded ${r.url} as artifact ${a.id} (${a.name}, ${a.sizeBytes} bytes).` }, summary: `downloaded ${a.name}` };
        }
        default:
          throw new Error(`unhandled browser tool ${name}`);
      }
    }),
  );
}

async function runScheduleTool(d: Deps, ref: ToolRef, name: string, input: Record<string, unknown>, task: Awaited<ReturnType<typeof getTaskForOwner>>): Promise<RunOutcome> {
  if (name === 'schedule_list') {
    const rows = (await listSchedules(d.db, ref.ownerId)).filter((s) => s.state !== 'deleted');
    const text = rows.length
      ? rows.map((s) => `- ${s.id} · “${s.name}” · ${describeSpec(s.spec as ScheduleSpecInput)} (${s.timezone}) · ${s.state}${s.chatId === task.chatId ? ' · this chat' : ''}`).join('\n')
      : 'No routines yet.';
    return { ok: true, output: { type: 'text', value: text }, summary: `${rows.length} routines` };
  }
  if (name === 'schedule_create') {
    const timezone = (input.timezone as string | undefined) ?? task.timezone ?? 'UTC';
    if (!isIanaTimezone(timezone)) return { ok: false, output: { type: 'error-text', value: `Unknown timezone ${timezone}.` }, summary: 'bad timezone' };
    const spec = ScheduleSpecInput.parse(input.cron ? { kind: 'cron', cron: input.cron } : { kind: 'interval', everyMinutes: input.everyMinutes });
    const s = await createScheduleWithOutbox(d.db, {
      ownerId: ref.ownerId,
      name: input.name as string,
      prompt: input.prompt as string,
      spec,
      timezone,
      allowedDomains: task.allowedDomains,
      catchupWindowMinutes: 10,
      chatId: task.chatId,
    });
    await emit(d, ref.ownerId, ref.taskId, 'schedule.changed', `schedule.changed:${s.id}:created`, { scheduleId: s.id, name: s.name, action: 'created' });
    return { ok: true, output: { type: 'text', value: `Created routine ${s.id} “${s.name}” (${describeSpec(spec)}, ${timezone}). Its results will be posted in this chat.` }, summary: `created routine ${s.name}` };
  }
  const t = name.replace('schedule_', '') as ScheduleTransition;
  const { schedule, state } = await transitionSchedule(d.db, ref.ownerId, input.id as string, t);
  await emit(d, ref.ownerId, ref.taskId, 'schedule.changed', `schedule.changed:${schedule.id}:${t}:${ref.toolCallId}`, { scheduleId: schedule.id, name: schedule.name, action: t });
  return { ok: true, output: { type: 'text', value: `Routine “${schedule.name}” is now ${state}.` }, summary: `${t} routine ${schedule.name}` };
}

async function runConnectorRead(d: Deps, ref: ToolRef, spec: AnyToolSpec, input: Record<string, unknown>, signal: AbortSignal): Promise<RunOutcome> {
  if (!isConnectorSpec(spec) || !spec.toolkit || !spec.composioSlug) throw new Error('not a connector tool');
  if (spec.classification === 'external_write') throw new Error('external writes only run through executeApprovedAction');
  const conn = await activeConnection(d.db, ref.ownerId, spec.toolkit);
  if (!conn?.composioConnectedAccountId) throw new Error(`no active ${spec.toolkit} connection`);
  const res = await d.connector().execute(conn.composioUserId, spec.toolkit as Toolkit, conn.composioConnectedAccountId, spec.composioSlug, input, AbortSignal.any([signal, AbortSignal.timeout(90_000)]));
  await recordUsage(d.db, { ownerId: ref.ownerId, taskId: ref.taskId, kind: 'composio', provider: 'composio', model: spec.composioSlug, requestId: res.logId, dedupeKey: `composio:${ref.toolCallId}`, quantity: '1 tool call', costNanos: null, costStatus: 'unknown' });
  if (!res.ok) {
    if (/auth|token|expired|revoked|unauthori[sz]ed|401|403/i.test(res.error ?? '')) {
      await updateConnection(d.db, ref.ownerId, conn.id, { status: 'expired' });
      await emit(d, ref.ownerId, ref.taskId, 'connection.expired', `connection.expired:${conn.id}`, { toolkit: spec.toolkit });
      return { ok: false, output: { type: 'error-text', value: `The ${spec.toolkit} connection needs to be reconnected by the user.` }, summary: 'connection expired' };
    }
    return { ok: false, output: { type: 'error-text', value: `Tool error: ${clip(res.error ?? 'unknown error', 1000)}` }, summary: 'connector error' };
  }
  const text = `[UNTRUSTED ${spec.toolkit.toUpperCase()} DATA START]\n${clip(JSON.stringify(res.data), 12_000)}\n[UNTRUSTED DATA END]`;
  return { ok: true, output: { type: 'text', value: text }, summary: `${spec.composioSlug} ok` };
}

export async function executeTool(d: Deps, ref: ToolRef): Promise<ToolExecutionResult> {
  const { tc, spec } = await loadCall(d, ref);
  if (tc.status === 'done' || tc.status === 'failed') return { toolCallId: ref.toolCallId, ok: tc.status === 'done', summary: tc.resultSummary ?? tc.status };
  if (!spec || tc.status !== 'allowed') throw new NotFoundError('allowed tool call');
  const input = spec.schema.parse(tc.input) as Record<string, unknown>;
  const task = await getTaskForOwner(d.db, ref.ownerId, ref.taskId);
  await emit(d, ref.ownerId, ref.taskId, 'tool.started', `tool.started:${ref.toolCallId}`, { tool: tc.toolName });

  let outcome: RunOutcome;
  try {
    outcome = await taskScope.run({ ownerId: ref.ownerId, taskId: ref.taskId }, () =>
      supervised(async (signal) => {
        switch (spec.executor) {
          case 'local': {
            if (spec.name.startsWith('schedule_')) return runScheduleTool(d, ref, spec.name, input, task);
            const m = await createMemory(d.db, ref.ownerId, input.content as string, { source: 'agent', taskId: ref.taskId, toolCallId: ref.toolCallId });
            return { ok: true, output: { type: 'text', value: `Saved memory ${m.id}. The user can review, edit or delete it.` }, summary: 'memory saved' } satisfies RunOutcome;
          }
          case 'workspace':
            return runWorkspaceTool(d, ref, spec.name, input);
          case 'browser':
            return runBrowserTool(d, ref, spec.name, input, task.allowedDomains);
          case 'connector':
            return runConnectorRead(d, ref, spec, input, signal);
        }
      }),
    );
  } catch (err) {
    if (err instanceof CancelledFailure) throw err;
    const expected = err instanceof BrowserPolicyError || err instanceof WorkspacePathError;
    const msg = err instanceof Error ? err.message : String(err);
    d.log.warn('tool.failed', { taskId: ref.taskId, tool: tc.toolName, error: msg });
    outcome = { ok: false, output: { type: 'error-text', value: expected ? `Blocked: ${msg}` : `Tool failed: ${clip(msg, 500)}` }, summary: clip(msg, 200) };
  }

  await writeResult(d, ref, tc, outcome.output);
  await setToolCallStatus(d.db, ref.ownerId, ref.toolCallId, outcome.ok ? 'done' : 'failed', outcome.summary);
  await emit(d, ref.ownerId, ref.taskId, outcome.ok ? 'tool.completed' : 'tool.failed', `tool.result:${ref.toolCallId}`, { tool: tc.toolName, summary: outcome.summary });
  if (task.status === 'waiting_approval') await setTaskStatus(d.db, ref.ownerId, ref.taskId, 'running');
  return { toolCallId: ref.toolCallId, ok: outcome.ok, summary: outcome.summary };
}

