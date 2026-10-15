import { z } from "zod";
import { invalidateExternalTools } from "@/server/connectors/external-tools";
import { addMcpServer, builtinLhosServer, listMcpServers } from "@/server/connectors/store";
import { parseBody } from "@/server/lib/body";
import { json, ownerRoute } from "@/server/lib/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = ownerRoute(async () =>
  json({ servers: [builtinLhosServer(), ...(await listMcpServers())] }),
);

export const POST = ownerRoute(async ({ request }) => {
  const body = await parseBody(
    request,
    z.object({
      name: z.string().trim().regex(/^[a-z0-9_]{1,24}$/, "Lowercase letters, digits and underscore only."),
      url: z.url().refine((u) => /^https?:\/\//.test(u), "Must be an http(s) URL."),
      bearer: z.string().trim().max(2000).optional(),
    }),
  );
  const server = await addMcpServer({ name: body.name, url: body.url, bearer: body.bearer || undefined });
  invalidateExternalTools();
  return json({ server }, { status: 201 });
});
