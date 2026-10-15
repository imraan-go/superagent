import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { chats, runs } from "@/server/db/schema";
import { isActive, replay, subscribe } from "@/server/agent/registry";
import { AppError } from "@/server/lib/errors";
import { errorResponse } from "@/server/lib/route";
import { getOwner } from "@/server/auth/session";
import { dropSupersededTerminals, isTerminal } from "@/lib/run-events";
import type { RunEvent, RunFrame } from "@/lib/run-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Keeps proxies and browsers from timing out a quiet stream. */
const HEARTBEAT_MS = 15_000;

/**
 * SSE transcript for one run.
 *
 * Reconnect is handled by `Last-Event-ID`: frames after that sequence are
 * replayed from the registry buffer (or `run_events`) *before* the live stream
 * attaches, so nothing is lost and nothing is duplicated (ADR-05).
 *
 * Not wrapped in `ownerRoute` because the response is a stream, not JSON — the
 * session check is done explicitly here instead.
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const owner = await getOwner();
    if (!owner) throw new AppError("unauthorized", "Sign in required.");

    const { id: runId } = await ctx.params;
    if (!z.uuid().safeParse(runId).success) {
      throw new AppError("not_found", "That run does not exist.");
    }

    const [run] = await db
      .select({
        id: runs.id,
        status: runs.status,
        error: runs.error,
        userId: chats.userId,
      })
      .from(runs)
      .innerJoin(chats, eq(chats.id, runs.chatId))
      .where(eq(runs.id, runId))
      .limit(1);

    if (!run || run.userId !== owner.userId) {
      throw new AppError("not_found", "That run does not exist.");
    }

    const lastEventId = Number.parseInt(
      request.headers.get("last-event-id") ??
        new URL(request.url).searchParams.get("lastEventId") ??
        "0",
      10,
    );
    const afterSeq = Number.isFinite(lastEventId) && lastEventId > 0 ? lastEventId : 0;

    const missed = dropSupersededTerminals(await replay(runId, afterSeq));
    const live = isActive(runId);

    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | undefined;
    let heartbeat: NodeJS.Timeout | undefined;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        const close = () => {
          if (closed) return;
          closed = true;
          unsubscribe?.();
          if (heartbeat) clearInterval(heartbeat);
          try {
            controller.close();
          } catch {
            // Already closed by the client disconnecting.
          }
        };

        const write = (frame: RunFrame) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(serialise(frame)));
          } catch {
            close();
            return;
          }
          if (isTerminal(frame.event)) close();
        };

        for (const frame of missed) write(frame);

        if (!live) {
          // The run is over and the replay above is the whole story. A client
          // that is already caught up (empty replay after a real seq) has seen
          // the terminal frame; synthesising another would contradict it.
          const sawTerminal = missed.some((f) => isTerminal(f.event));
          const caughtUp = missed.length === 0 && afterSeq > 0;

          if (!sawTerminal && !caughtUp) {
            // No events survive — most likely a restart lost the buffer. Send a
            // terminal frame so the UI settles instead of spinning forever.
            controller.enqueue(
              encoder.encode(
                serialise({
                  seq: (missed.at(-1)?.seq ?? afterSeq) + 1,
                  event: terminalFor(run.status, run.error),
                }),
              ),
            );
          }
          close();
          return;
        }

        unsubscribe = subscribe(runId, write);
        heartbeat = setInterval(() => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(": ping\n\n"));
          } catch {
            close();
          }
        }, HEARTBEAT_MS);

        request.signal.addEventListener("abort", close, { once: true });
      },
      cancel() {
        unsubscribe?.();
        if (heartbeat) clearInterval(heartbeat);
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store, no-transform",
        connection: "keep-alive",
        // Belt and braces with next.config.ts: never let a proxy buffer this.
        "x-accel-buffering": "no",
      },
    });
  } catch (err) {
    return errorResponse(err, "/api/runs/[id]/events");
  }
}

/** Reconstructs a terminal frame from the persisted run row. */
function terminalFor(status: string, error: string | null): RunEvent {
  switch (status) {
    case "error":
      return { type: "error", code: "internal", message: error ?? "The run failed." };
    case "cancelled":
      return { type: "done", status: "cancelled" };
    case "paused_approval":
    case "paused_question":
      return { type: "done", status: "paused_approval" };
    default:
      return { type: "done", status: "done" };
  }
}

function serialise(frame: RunFrame): string {
  return `id: ${frame.seq}\nevent: ${frame.event.type}\ndata: ${JSON.stringify(frame.event)}\n\n`;
}
