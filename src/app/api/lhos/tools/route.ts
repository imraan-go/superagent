import { getCachedCatalogAge, getToolCatalog } from "@/server/lhos/catalog";
import { json, ownerRoute } from "@/server/lib/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tool catalogue for pickers and the Settings allowlist editor.
 *
 * Returns names plus descriptions only — the full JSON Schemas are 43 KB and
 * the browser has no use for them; argument validation happens server-side.
 */
export const GET = ownerRoute(async ({ request }) => {
  const force = new URL(request.url).searchParams.get("refresh") === "1";
  const tools = await getToolCatalog(force ? { force: true } : undefined);

  return json({
    count: tools.length,
    cacheAgeMs: getCachedCatalogAge(),
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description.split("\n")[0]?.slice(0, 240) ?? "",
    })),
  });
});
