import { isSection, paceArgs } from "@/lib/settings";
import type { AgentSettings, SettingsSection } from "@/lib/settings";
import { lhos } from "@/server/lhos/client";
import { AppError, toAppError } from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";
import { json, ownerRoute } from "@/server/lib/route";
import { getSection, updateSection } from "@/server/settings/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ section: string }> };

async function sectionOf(ctx: Ctx): Promise<SettingsSection> {
  const { section } = await ctx.params;
  if (!isSection(section)) throw new AppError("not_found", `Unknown settings section "${section}".`);
  return section;
}

/**
 * `GET /api/settings/<section>` → the section's JSON with defaults applied.
 * Contract relied on by the sound hook and notifications: the body *is* the
 * section object (no envelope).
 */
export const GET = ownerRoute<Ctx>(async ({ ctx }) => json(await getSection(await sectionOf(ctx))));

/** Partial patch; see `mergeSection` for semantics. Responds with the saved section. */
export const PUT = ownerRoute<Ctx>(async ({ request, ctx }) => {
  const section = await sectionOf(ctx);
  const body: unknown = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AppError("bad_request", "Body must be a JSON object.");
  }

  const before = section === "agent" ? await getSection("agent") : null;
  const saved = await updateSection(section, body);

  // Pace is applied to the agent computer immediately (ADR-08) so it holds
  // for runs started outside the panel too. Best effort: the setting is saved
  // either way; a failure is reported via the `x-pace-applied: 0` header.
  let paceApplied: boolean | undefined;
  if (before && (saved as AgentSettings).pace !== before.pace) {
    paceApplied = await applyPace((saved as AgentSettings).pace);
  }

  return json(saved, paceApplied === false ? { headers: { "x-pace-applied": "0" } } : undefined);
});

async function applyPace(pace: "fast" | "careful"): Promise<boolean> {
  try {
    await lhos.callTool("set_pace", paceArgs(pace), { timeoutMs: 15_000 });
    return true;
  } catch (err) {
    logger.warn("settings", { msg: "set_pace failed", code: toAppError(err).code });
    return false;
  }
}
