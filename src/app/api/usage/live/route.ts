import { z } from "zod";
import { getOwner } from "@/server/auth/session";
import { getChat } from "@/server/chat/repo";
import { AppError } from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";
import { errorResponse } from "@/server/lib/route";
import { dayKey, onUsage, startOfToday, usageSummary } from "@/server/usage/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 15_000;
/** Coalesce bursts (several steps finishing together) into one query. */
const DEBOUNCE_MS = 250;

/**
 * SSE usage ticker: today's totals (+ one chat's when `?chatId=`), pushed on
 * connect, after every recorded usage event, and when the day rolls over.
 * Session-checked explicitly (stream, not JSON — same as runs/[id]/events).
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const owner = await getOwner();
    if (!owner) throw new AppError("unauthorized", "Sign in required.");

    const raw = new URL(request.url).searchParams.get("chatId");
    let chatId: string | null = null;
    if (raw) {
      if (!z.uuid().safeParse(raw).success) throw new AppError("not_found", "That chat does not exist.");
      await getChat(raw, owner.userId); // throws not_found for someone else's chat
      chatId = raw;
    }

    const encoder = new TextEncoder();
    let cleanup = () => {};

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        let timer: NodeJS.Timeout | null = null;
        let day = dayKey(startOfToday());

        const send = async () => {
          if (closed) return;
          try {
            const summary = await usageSummary(chatId);
            day = summary.day;
            if (!closed) {
              controller.enqueue(encoder.encode(`event: usage\ndata: ${JSON.stringify(summary)}\n\n`));
            }
          } catch (err) {
            logger.warn("usage.live", { message: err instanceof Error ? err.message : String(err) });
          }
        };
        const schedule = () => {
          if (timer) return;
          timer = setTimeout(() => {
            timer = null;
            void send();
          }, DEBOUNCE_MS);
        };

        // Any usage event moves today's total, so every event re-sends.
        const off = onUsage(() => schedule());
        const heartbeat = setInterval(() => {
          if (closed) return;
          if (dayKey(startOfToday()) !== day) {
            void send(); // midnight rollover resets "today"
            return;
          }
          try {
            controller.enqueue(encoder.encode(": ping\n\n"));
          } catch {
            cleanup();
          }
        }, HEARTBEAT_MS);

        cleanup = () => {
          if (closed) return;
          closed = true;
          off();
          clearInterval(heartbeat);
          if (timer) clearTimeout(timer);
          try {
            controller.close();
          } catch {
            // already closed by the client
          }
        };
        request.signal.addEventListener("abort", cleanup, { once: true });
        void send();
      },
      cancel() {
        cleanup();
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  } catch (err) {
    return errorResponse(err, "/api/usage/live");
  }
}
