import { isProtectedPath, normalizePersistPath, parseLs } from "@/lib/manage/persist-paths";
import { AppError } from "@/server/lib/errors";
import { json, ownerRoute } from "@/server/lib/route";
import { toolText } from "@/server/manage/ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lists a directory under the agent computer's ~/persist (LHOS list_files). */
export const GET = ownerRoute(async ({ request }) => {
  const dir = normalizePersistPath(new URL(request.url).searchParams.get("dir") ?? "");
  if (dir === null) throw new AppError("bad_request", "Invalid path.");
  // Protected directories (chrome-cdp) are listed from their parent but never opened.
  if (dir !== "" && isProtectedPath(dir)) {
    throw new AppError("bad_request", "That location is protected and cannot be browsed.");
  }
  const text = await toolText("list_files", { subdir: dir });
  return json({ dir, entries: parseLs(text, dir) });
});
