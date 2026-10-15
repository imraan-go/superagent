import { z } from "zod";
import { json, ownerRoute } from "@/server/lib/route";
import { RUNNABLE_MAINTENANCE_TASKS } from "@/server/manage/locks";
import { auditedTool, parseBody, toolJson, toolText } from "@/server/manage/ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const statusSchema = z.looseObject({
  disk: z
    .looseObject({
      total_gb: z.number(),
      used_gb: z.number(),
      free_gb: z.number(),
      used_pct: z.number(),
    })
    .optional(),
  snapshots: z.looseObject({ count: z.number(), total_mb: z.number(), keep: z.number().optional() }).optional(),
});

export const GET = ownerRoute(async () => {
  const status = await toolJson("maintenance_status", statusSchema);
  // The per-build list is served by /api/manage/snapshots; drop it here.
  const { snapshots, ...rest } = status;
  return json({
    ...rest,
    snapshots: snapshots ? { count: snapshots.count, total_mb: snapshots.total_mb, keep: snapshots.keep } : undefined,
    runnable: RUNNABLE_MAINTENANCE_TASKS,
  });
});

// The enum is the lock: snapshot_prune (and anything else) fails validation.
const runSchema = z.object({
  task: z.enum(RUNNABLE_MAINTENANCE_TASKS),
  dryRun: z.boolean().default(false),
});

export const POST = ownerRoute(async ({ request }) => {
  const { task, dryRun } = await parseBody(request, runSchema);
  const text = await auditedTool("maintenance.run", { task, dryRun }, () =>
    toolText("maintenance_run_now", { task, dry_run: dryRun }),
  );
  return json({ ok: true, output: text.slice(0, 4000) });
});
