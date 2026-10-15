import { lhos } from "@/server/lhos/client";
import { json, ownerRoute } from "@/server/lib/route";
import { toAppError } from "@/server/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pending human-in-the-loop items, split by how each can be answered (ADR-02):
 *
 *  - `confirm`  → POST /api/approvals/{id} (proxied with APPROVE_TOKEN)
 *  - `ask` / `takeover` → answered on the desktop or via the Manage host
 *    bridge; the panel surfaces them but cannot decide them here.
 *
 * `decidable` is computed server-side so the UI never has to encode that rule.
 */
export const GET = ownerRoute(async () => {
  try {
    const pending = await lhos.getPendingApprovals();

    return json({
      reachable: true,
      count: pending.length,
      items: pending.map((item) => ({
        id: item.id,
        kind: item.kind,
        prompt: item.prompt,
        createdAt: new Date(item.created * 1000).toISOString(),
        decidable: item.kind === "confirm",
      })),
    });
  } catch (err) {
    const appErr = toAppError(err);
    // Polled every 5 s while a run is active — a blip must not spam errors.
    return json({
      reachable: false,
      count: 0,
      items: [],
      code: appErr.code,
      message: appErr.message,
    });
  }
});
