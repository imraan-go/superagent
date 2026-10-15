import { bridge } from "@/server/manage/bridge";
import { json, ownerRoute } from "@/server/lib/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Masked config.env. The bridge already blanks secret values; this route
 * blanks them again so the guarantee does not rest on one layer.
 */
export const GET = ownerRoute(async () => {
  const rows = await bridge.config();
  return json({
    config: rows.map((r) => ({ ...r, value: r.secret ? null : r.value })),
  });
});
