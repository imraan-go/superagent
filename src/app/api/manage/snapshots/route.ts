import { z } from "zod";
import { json, ownerRoute } from "@/server/lib/route";
import { toolJson } from "@/server/manage/ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const snapshotsSchema = z.looseObject({
  dir: z.string().optional(),
  count: z.number(),
  total_mb: z.number(),
  keep: z.number().optional(),
  db_ok: z.boolean().optional(),
  snapshots: z.array(
    z.looseObject({
      build: z.string(),
      size_mb: z.number(),
      age_min: z.number(),
      protected: z.boolean(),
    }),
  ),
});

/**
 * Read-only. snapshot_prune is deliberately never called anywhere in the panel
 * (diff-layer chain incident, 2026-10).
 */
export const GET = ownerRoute(async () => json(await toolJson("snapshot_list", snapshotsSchema)));
