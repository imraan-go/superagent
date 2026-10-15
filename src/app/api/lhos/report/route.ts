import { z } from "zod";
import { lhos } from "@/server/lhos/client";
import { AppError } from "@/server/lib/errors";
import { ownerRoute } from "@/server/lib/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Daily activity report as markdown; rendered by Manage → Reports. */
export const GET = ownerRoute(async ({ request }) => {
  const raw = new URL(request.url).searchParams.get("date");

  if (raw !== null && !dateSchema.safeParse(raw).success) {
    throw new AppError("bad_request", "date must be YYYY-MM-DD");
  }

  const markdown = await lhos.getReport(raw ?? undefined);

  return new Response(markdown, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "no-store",
    },
  });
});
