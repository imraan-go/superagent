import { z } from "zod";
import { getSession } from "@/server/auth/session";
import { AppError } from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";
import { json, ownerRoute } from "@/server/lib/route";
import { bumpSessionEpoch, updateSection } from "@/server/settings/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Settings → Danger zone. The UI gates each action behind HoldToConfirm.
 *
 * - `archiveUsage`: marks now as the start of the Usage view. Mark only —
 *   `usage_events` rows are never deleted.
 * - `signOutEverywhere`: bumps the session epoch so every existing session
 *   (this one included) fails `getOwner()`, then clears this cookie.
 */
const bodySchema = z.object({ action: z.enum(["archiveUsage", "signOutEverywhere"]) });

export const POST = ownerRoute(async ({ request }) => {
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) throw new AppError("bad_request", "Unknown action.");

  if (body.data.action === "archiveUsage") {
    const usage = await updateSection("usage", { archivedAt: new Date().toISOString() });
    return json({ ok: true, archivedAt: usage.archivedAt });
  }

  const epoch = await bumpSessionEpoch();
  const session = await getSession();
  session.destroy();
  logger.info("auth", { msg: "signed out everywhere", epoch });
  return json({ ok: true, signedOut: true });
});
