import { z } from "zod";
import { listMemories, remember } from "@/server/memory";
import { parseBody } from "@/server/lib/body";
import { json, ownerRoute } from "@/server/lib/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = ownerRoute(async ({ request }) => {
  const q = new URL(request.url).searchParams.get("q")?.trim().slice(0, 200) || undefined;
  return json({ memories: await listMemories(q) });
});

export const POST = ownerRoute(async ({ request }) => {
  const body = await parseBody(
    request,
    z.object({
      text: z.string().trim().min(3).max(1000),
      kind: z.enum(["fact", "preference", "project"]).default("fact"),
    }),
  );
  const id = await remember(body);
  return json({ id, duplicate: id === null }, { status: id ? 201 : 200 });
});
