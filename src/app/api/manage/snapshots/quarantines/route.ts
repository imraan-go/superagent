import { json, ownerRoute } from "@/server/lib/route";
import { bridge } from "@/server/manage/bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = ownerRoute(async () => json({ quarantines: await bridge.snapshotQuarantines() }));
