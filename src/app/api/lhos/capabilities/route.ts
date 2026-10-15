import { lhos } from "@/server/lhos/client";
import { json, ownerRoute } from "@/server/lib/route";
import { toAppError } from "@/server/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Drives the topbar connection dot and the Mission panel status. Returns 200
 * with `{ reachable: false }` rather than an error status so the dot can show
 * "waking" / "offline" without the client treating it as a failed request.
 */
export const GET = ownerRoute(async () => {
  try {
    const capabilities = await lhos.getCapabilities();
    return json({
      reachable: true,
      desktopUp: capabilities.desktop?.up ?? false,
      sandboxId: capabilities.desktop?.sandbox_id ?? null,
      rdpConnected: capabilities.rdp?.connected ?? false,
      pace: capabilities.pace?.mode ?? null,
      pendingHumanRequests: capabilities.pending_human_requests ?? 0,
      capabilities,
    });
  } catch (err) {
    const appErr = toAppError(err);
    return json({
      reachable: false,
      waking: appErr.code === "computer_waking",
      code: appErr.code,
      message: appErr.message,
    });
  }
});
