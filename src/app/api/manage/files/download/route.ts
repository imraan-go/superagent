import { z } from "zod";
import { isProtectedPath, normalizePersistPath } from "@/lib/manage/persist-paths";
import { AppError } from "@/server/lib/errors";
import { json, ownerRoute } from "@/server/lib/route";
import { auditedTool, parseBody, toolText } from "@/server/manage/ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ path: z.string().min(1).max(500) });

/** Short-lived signed link (LHOS share_file). Protected paths are refused here, not just in the UI. */
export const POST = ownerRoute(async ({ request }) => {
  const { path } = await parseBody(request, bodySchema);
  const rel = normalizePersistPath(path);
  if (!rel) throw new AppError("bad_request", "Invalid path.");
  if (isProtectedPath(rel)) throw new AppError("bad_request", "That file is protected and cannot be downloaded.");

  const text = await auditedTool("persist.share", { path: rel }, () =>
    toolText("share_file", { filename: rel, hours: 1 }),
    "signed link issued (1h, not stored)",
  );
  const url = /https?:\/\/[^\s"')]+/.exec(text)?.[0];
  if (!url) throw new AppError("tool_failed", "The agent computer did not return a download link.");
  return json({ url });
});
