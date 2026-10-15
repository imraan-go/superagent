import { z } from "zod";
import { ComposioClient } from "@/server/connectors/composio-client";
import { getToolkitDetailForOwner } from "@/server/connectors/composio-detail";
import { getComposioKey } from "@/server/connectors/store";
import { parseQuery } from "@/server/lib/body";
import { AppError } from "@/server/lib/errors";
import { json, ownerRoute } from "@/server/lib/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One toolkit in one call: catalog entry + tools (read/write, enabled) + trigger types. Cached 1 h upstream-side. */
export const GET = ownerRoute(async ({ request }) => {
  const { slug } = parseQuery(request.url, z.object({ slug: z.string().trim().regex(/^[a-z0-9_-]{1,64}$/i) }));
  const key = await getComposioKey();
  if (!key) throw new AppError("bad_request", "Add your Composio API key first.");
  return json(await getToolkitDetailForOwner(new ComposioClient(key.key), slug));
});
