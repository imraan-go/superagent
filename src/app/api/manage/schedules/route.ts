import { z } from "zod";
import { json, ownerRoute } from "@/server/lib/route";
import { toolJson } from "@/server/manage/ops";
import { isLockedSchedule } from "@/server/manage/locks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schedulesSchema = z.array(
  z.looseObject({
    name: z.string(),
    cron: z.string().optional(),
    enabled: z.boolean(),
    target: z.string().optional(),
    next_run_utc: z.string().nullish(),
    last_status: z.string().nullish(),
  }),
);

export const GET = ownerRoute(async () => {
  const schedules = await toolJson("schedule_list", schedulesSchema);
  return json({ schedules: schedules.map((s) => ({ ...s, locked: isLockedSchedule(s.name) })) });
});
