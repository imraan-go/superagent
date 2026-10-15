import { ownerRoute } from "@/server/lib/route";
import { parseUsageQuery, usageCsv, usageReport } from "@/server/usage/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Same query as `/api/usage/report`, as a CSV download. */
export const GET = ownerRoute(async ({ request }) => {
  const report = await usageReport(parseUsageQuery(new URL(request.url)));
  const name = `usage-${report.groupBy}-${report.from}_${report.to}.csv`;
  return new Response(usageCsv(report), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
});
