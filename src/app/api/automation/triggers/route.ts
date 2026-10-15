import { listTriggerUrls } from "@/server/automation/webhooks";
import { json, ownerRoute } from "@/server/lib/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** LHOS trigger URLs for saved workflows. They embed a token — owner-only. */
export const GET = ownerRoute(async () => json({ triggers: await listTriggerUrls() }));
