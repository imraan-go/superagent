import "server-only";
import { and, asc, eq, gt } from "drizzle-orm";
import { db } from "@/server/db";
import { runEvents } from "@/server/db/schema";
import { logger } from "@/server/lib/logger";
import { isTerminal } from "@/lib/run-events";
import type { RunEvent, RunFrame } from "@/lib/run-events";

/**
 * In-process registry of active runs (ADR-04: the panel runs a single
 * instance, deliberately, because this state cannot be shared).
 *
 * Each run owns an abort controller, a sequence counter, a replay buffer and
 * its live subscribers. Stored on `globalThis` so Next's dev HMR does not
 * orphan a running agent behind a fresh module instance.
 */
const BUFFER_LIMIT = 4_000;
const FLUSH_MS = 500;
const FLUSH_FRAMES = 64;

interface ActiveRun {
  runId: string;
  controller: AbortController;
  seq: number;
  /** Recent frames for resume; trimmed to BUFFER_LIMIT. */
  buffer: RunFrame[];
  subscribers: Set<(frame: RunFrame) => void>;
  pending: RunFrame[];
  flushTimer: NodeJS.Timeout | null;
  ended: boolean;
}

const store = globalThis as unknown as { __fdRuns?: Map<string, ActiveRun> };
const runs: Map<string, ActiveRun> = (store.__fdRuns ??= new Map());

/**
 * Registers a run. `initialSeq` is non-zero when a paused run resumes: its
 * sequence continues where the paused segment stopped, so subscribers that
 * reconnect with `Last-Event-ID` see the resumed frames and nothing twice.
 */
export function startRun(runId: string, initialSeq = 0): AbortController {
  const controller = new AbortController();
  const previous = runs.get(runId);
  if (previous?.flushTimer) clearTimeout(previous.flushTimer);
  runs.set(runId, {
    runId,
    controller,
    seq: Math.max(initialSeq, previous?.seq ?? 0),
    buffer: [],
    subscribers: new Set(),
    pending: [],
    flushTimer: null,
    ended: false,
  });
  return controller;
}

export function isActive(runId: string): boolean {
  const run = runs.get(runId);
  return Boolean(run && !run.ended);
}

/**
 * Cancels a run. Aborting the controller stops the model stream *and* any
 * in-flight LHOS call, because both are passed the same signal
 * (skill-agent-loop §Gotchas).
 */
export function cancelRun(runId: string): boolean {
  const run = runs.get(runId);
  if (!run || run.ended) return false;
  run.controller.abort();
  return true;
}

/**
 * Assigns the next sequence number, delivers the frame to live subscribers
 * immediately, and queues it for persistence. Delivery is never blocked on the
 * database — a slow write must not stutter the stream.
 */
export function emit(runId: string, event: RunEvent): RunFrame | null {
  const run = runs.get(runId);
  if (!run) return null;

  run.seq += 1;
  const frame: RunFrame = { seq: run.seq, event };

  run.buffer.push(frame);
  if (run.buffer.length > BUFFER_LIMIT) run.buffer.shift();

  for (const send of run.subscribers) {
    try {
      send(frame);
    } catch {
      // A dead stream is removed by its own cleanup; never break the loop.
    }
  }

  run.pending.push(frame);
  if (run.pending.length >= FLUSH_FRAMES || isTerminal(event)) {
    void flush(run);
  } else {
    run.flushTimer ??= setTimeout(() => void flush(run), FLUSH_MS);
  }

  if (isTerminal(event)) run.ended = true;
  return frame;
}

async function flush(run: ActiveRun): Promise<void> {
  if (run.flushTimer) {
    clearTimeout(run.flushTimer);
    run.flushTimer = null;
  }
  if (run.pending.length === 0) return;

  const batch = run.pending.splice(0, run.pending.length);
  try {
    await db.insert(runEvents).values(
      batch.map((f) => ({
        runId: run.runId,
        seq: f.seq,
        type: f.event.type,
        data: f.event as unknown as Record<string, unknown>,
      })),
    );
  } catch (err) {
    // Losing the audit copy must not kill a live run; the buffer still serves
    // resume for as long as the process is up.
    logger.error("run-events", {
      runId: run.runId,
      msg: "failed to persist events",
      count: batch.length,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

export function subscribe(
  runId: string,
  send: (frame: RunFrame) => void,
): () => void {
  const run = runs.get(runId);
  if (!run) return () => {};

  run.subscribers.add(send);
  return () => {
    run.subscribers.delete(send);
  };
}

/**
 * Frames after `afterSeq`, for a client reconnecting with `Last-Event-ID`.
 *
 * The in-memory buffer is preferred because it is complete and current; the
 * database is the fallback once the buffer has rolled over or the process has
 * restarted.
 */
export async function replay(runId: string, afterSeq: number): Promise<RunFrame[]> {
  const run = runs.get(runId);
  const oldest = run?.buffer[0]?.seq;

  if (run && oldest !== undefined && oldest <= afterSeq + 1) {
    return run.buffer.filter((f) => f.seq > afterSeq);
  }
  if (run && run.buffer.length === 0 && run.seq === afterSeq) {
    return [];
  }

  const rows = await db
    .select({ seq: runEvents.seq, data: runEvents.data })
    .from(runEvents)
    .where(and(eq(runEvents.runId, runId), gt(runEvents.seq, afterSeq)))
    .orderBy(asc(runEvents.seq));

  return rows.map((r) => ({ seq: r.seq, event: r.data as unknown as RunEvent }));
}

/** Releases registry state once every subscriber has detached. */
export function finishRun(runId: string): void {
  const run = runs.get(runId);
  if (!run) return;
  run.ended = true;
  void flush(run).then(() => {
    if (run.subscribers.size === 0) runs.delete(runId);
  });
}

export function currentSeq(runId: string): number {
  return runs.get(runId)?.seq ?? 0;
}
