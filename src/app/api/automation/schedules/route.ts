import { createSchedule, createScheduleSchema, listPanelSchedules, syncLhosSchedules } from "@/server/automation/schedules";
import { parseBody } from "@/server/lib/body";
import { json, ownerRoute } from "@/server/lib/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** LHOS schedules (live, mirrored to the cache) + panel-native scheduled prompts. */
export const GET = ownerRoute(async () => {
  const [lhos, panel] = await Promise.all([syncLhosSchedules(), listPanelSchedules()]);
  return json({ lhos: lhos.views, lhosError: lhos.error, panel });
});

export const POST = ownerRoute(async ({ request }) => {
  await createSchedule(await parseBody(request, createScheduleSchema));
  return json({ ok: true }, { status: 201 });
});
