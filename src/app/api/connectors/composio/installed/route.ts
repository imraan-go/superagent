import { ComposioClient } from "@/server/connectors/composio-client";
import { installedApps } from "@/server/connectors/composio-installed";
import { getComposioKey } from "@/server/connectors/store";
import { AppError } from "@/server/lib/errors";
import { json, ownerRoute } from "@/server/lib/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Manage view: the owner's connected apps with status and "N of M tools enabled". */
export const GET = ownerRoute(async () => {
  const key = await getComposioKey();
  if (!key) throw new AppError("bad_request", "Add your Composio API key first.");
  return json({ apps: await installedApps(new ComposioClient(key.key)) });
});
