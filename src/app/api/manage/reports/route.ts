import { z } from "zod";
import { json, ownerRoute } from "@/server/lib/route";
import { bridge } from "@/server/manage/bridge";
import { auditedTool, parseBody, toolText } from "@/server/manage/ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = ownerRoute(async () => json({ reports: await bridge.reports() }));

const generateSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
    .optional(),
});

/** "Generate now": LHOS session_report, which also writes logs/<date>.md. */
export const POST = ownerRoute(async ({ request }) => {
  const { date } = await parseBody(request, generateSchema);
  const text = await auditedTool("report.generate", { date: date ?? "today" }, () =>
    toolText("session_report", { date: date ?? "", write: true }),
  );
  return json({ ok: true, bytes: text.length });
});
