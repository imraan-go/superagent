import { pendingSnapshot } from "@/server/hitl/pending";
import { json, ownerRoute } from "@/server/lib/route";
import { toAppError } from "@/server/lib/errors";
import type { PendingResponse } from "@/lib/hitl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Everything waiting on the owner, across all three sources (ADR-02):
 * panel checkpoints, LHOS `confirm` records, and `ask`/`takeover` requests.
 *
 * How each item is answered follows from `source` + `kind`:
 *  - panel / confirm → POST /api/approvals/{uuid}   (resumes the paused run)
 *  - lhos  / confirm → POST /api/approvals/{8-hex}  (APPROVE_TOKEN proxy)
 *  - lhos  / ask      → POST /api/hitl/{id}/answer  (host bridge)
 *  - lhos  / takeover → POST /api/hitl/{id}/done    (host bridge)
 *
 * Reading also reconciles: records LHOS no longer lists were decided
 * elsewhere and are closed with `decided_via` = 'lhos-page' / 'desktop'.
 */
export const GET = ownerRoute(async () => {
  try {
    const snap = await pendingSnapshot();
    const body: PendingResponse = { ...snap, count: snap.items.length };
    return json(body);
  } catch (err) {
    const appErr = toAppError(err);
    // Polled every 5 s while a run is active — a blip must not spam errors.
    return json({
      reachable: false,
      count: 0,
      items: [],
      running: 0,
      code: appErr.code,
      message: appErr.message,
    });
  }
});
