import { bridge } from "@/server/manage/bridge";
import { json, ownerRoute } from "@/server/lib/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = ownerRoute(async () => json({ desktop: await bridge.desktop() }));
