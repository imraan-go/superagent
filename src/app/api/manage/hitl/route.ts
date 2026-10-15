import { json, ownerRoute } from "@/server/lib/route";
import { bridge } from "@/server/manage/bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read-only inbox; answering is handled by the Agent view. */
export const GET = ownerRoute(async () => json({ pending: await bridge.hitlPending() }));
