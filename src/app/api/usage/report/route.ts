import { json, ownerRoute } from "@/server/lib/route";
import { getSection } from "@/server/settings/store";
import { parseUsageQuery, usageReport } from "@/server/usage/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/usage/report?groupBy=day|vendor|model|chat&from=YYYY-MM-DD&to=YYYY-MM-DD`
 * → grouped rows, totals, today's spend and the budget settings.
 */
export const GET = ownerRoute(async ({ request }) => {
  const [report, budget] = await Promise.all([
    usageReport(parseUsageQuery(new URL(request.url))),
    getSection("usage"),
  ]);
  return json({ ...report, budget });
});
