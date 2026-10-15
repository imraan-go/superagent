import { getAllSettings } from "@/server/settings/store";
import { json, ownerRoute } from "@/server/lib/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every settings section, defaults applied. Never contains secrets. */
export const GET = ownerRoute(async () => json({ settings: await getAllSettings() }));
