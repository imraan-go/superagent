import { advanceFollow, INITIAL_FOLLOW } from "@/lib/manage/log-follow";
import type { FollowState } from "@/lib/manage/log-follow";
import { logger } from "@/server/lib/logger";
import { ownerRoute } from "@/server/lib/route";
import { bridge } from "@/server/manage/bridge";
import { parseUnit } from "@/server/manage/ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ unit: string }> };

const POLL_MS = 2_000;
const HEARTBEAT_MS = 15_000;
const INITIAL_LINES = 200;
const POLL_LINES = 500;

/** Local wall-clock `YYYY-MM-DD HH:MM:SS`, the format the bridge's `since` accepts. */
function localStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * Follow mode: SSE that polls the bridge every 2 s with `since` and streams
 * only lines not yet delivered. Sends the last 200 lines first (`event: lines`),
 * then deltas; bridge failures are reported as `event: problem` and retried.
 */
export const GET = ownerRoute<Ctx>(async ({ request, ctx }) => {
  const unit = parseUnit((await ctx.params).unit);
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let state: FollowState = INITIAL_FOLLOW;
      let timer: NodeJS.Timeout | null = null;
      let lastWrite = Date.now();
      const startedAt = localStamp(new Date());

      const write = (event: string, data: unknown) => {
        if (closed) return;
        lastWrite = Date.now();
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const tick = async () => {
        if (closed) return;
        try {
          const first = state.since === null;
          const fetched = await bridge.logs(unit, first ? INITIAL_LINES : POLL_LINES, state.since ?? undefined);
          const { fresh, next } = advanceFollow(state, fetched);
          // No stamped line yet (quiet unit): start the window at connect time.
          state = next.since === null && first ? { since: startedAt, boundary: [] } : next;
          if (fresh.length > 0 || first) write("lines", { lines: fresh, initial: first });
        } catch (err) {
          logger.warn("manage.logs.stream", { unit, message: err instanceof Error ? err.message : String(err) });
          write("problem", { message: "Host bridge unreachable — retrying." });
        }
        if (!closed) {
          if (Date.now() - lastWrite > HEARTBEAT_MS) {
            lastWrite = Date.now();
            controller.enqueue(encoder.encode(": ping\n\n"));
          }
          timer = setTimeout(() => void tick(), POLL_MS);
        }
      };

      cleanup = () => {
        if (closed) return;
        closed = true;
        if (timer) clearTimeout(timer);
        try {
          controller.close();
        } catch {
          // already closed by the client
        }
      };
      request.signal.addEventListener("abort", cleanup, { once: true });
      void tick();
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
});
