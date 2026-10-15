import { z } from "zod";
import { invalidateExternalTools } from "@/server/connectors/external-tools";
import { McpClient } from "@/server/connectors/mcp-client";
import { LHOS_MCP_ID, deleteMcpServer, mcpCredentials, setMcpEnabled } from "@/server/connectors/store";
import { parseBody } from "@/server/lib/body";
import { AppError } from "@/server/lib/errors";
import { json, ownerRoute } from "@/server/lib/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Connects and lists the server's tools (a live connection test). */
export const GET = ownerRoute<Ctx>(async ({ ctx }) => {
  const { id } = await ctx.params;
  const cred = await mcpCredentials(id);
  if (!cred) throw new AppError("not_found", "No such MCP server.");
  try {
    const client = new McpClient(cred.url, cred.bearer, fetch, 20_000, cred.headers);
    const { serverName } = await client.initialize();
    const tools = await client.listTools();
    return json({
      ok: true,
      serverName,
      tools: tools.map((t) => ({ name: t.name, description: (t.description ?? "").slice(0, 200) })),
    });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err), tools: [] });
  }
});

function editable(id: string): string {
  if (id === LHOS_MCP_ID || !z.uuid().safeParse(id).success) {
    throw new AppError("bad_request", "The built-in LHOS entry is read-only.");
  }
  return id;
}

export const PATCH = ownerRoute<Ctx>(async ({ request, ctx }) => {
  const id = editable((await ctx.params).id);
  const body = await parseBody(request, z.object({ enabled: z.boolean() }));
  await setMcpEnabled(id, body.enabled);
  invalidateExternalTools();
  return json({ ok: true });
});

export const DELETE = ownerRoute<Ctx>(async ({ ctx }) => {
  const id = editable((await ctx.params).id);
  await deleteMcpServer(id);
  invalidateExternalTools();
  return json({ ok: true });
});
