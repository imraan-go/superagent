import { z } from "zod";
import { ComposioClient } from "@/server/connectors/composio-client";
import { queryCatalog } from "@/server/connectors/composio-catalog";
import { getCatalog } from "@/server/connectors/composio-tools";
import { getComposioKey } from "@/server/connectors/store";
import { parseQuery } from "@/server/lib/body";
import { AppError } from "@/server/lib/errors";
import { json, ownerRoute } from "@/server/lib/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().trim().max(80).optional(),
  category: z.string().trim().max(80).optional(),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(48),
  refresh: z.enum(["1"]).optional(),
});

/** The full Composio toolkit catalog (cached 1 h server-side), searched + paged here. */
export const GET = ownerRoute(async ({ request }) => {
  const key = await getComposioKey();
  if (!key) throw new AppError("bad_request", "Add your Composio API key first.");
  const q = parseQuery(request.url, querySchema);
  const all = await getCatalog(new ComposioClient(key.key), q.refresh === "1");
  const { items, total } = queryCatalog(all.toolkits, { search: q.q, category: q.category, offset: q.offset, limit: q.limit });
  return json({ items, total, offset: q.offset, categories: all.categories, catalogSize: all.toolkits.length });
});
