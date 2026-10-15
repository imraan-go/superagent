import { ComposioClient } from "@/server/connectors/composio-client";
import { getComposioConfig } from "@/server/connectors/composio-config";
import { COMPOSIO_MCP_NAME, ensureComposioMcp, removeComposioMcp } from "@/server/connectors/composio-service";
import { invalidateExternalTools } from "@/server/connectors/external-tools";
import { getComposioKey, listMcpServers } from "@/server/connectors/store";
import { AppError } from "@/server/lib/errors";
import { enforceRateLimit } from "@/server/lib/rate";
import { json, ownerRoute } from "@/server/lib/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The URL can carry credentials for some Composio deployments: flag it so the UI masks it. */
const SECRET_BEARING = /[?&](x-?api-?key|api[_-]?key|key|token|secret)=/i;

async function client(): Promise<ComposioClient> {
  const key = await getComposioKey();
  if (!key) throw new AppError("bad_request", "Add your Composio API key first.");
  return new ComposioClient(key.key);
}

export const GET = ownerRoute(async () => {
  const cfg = await getComposioConfig();
  const panel = (await listMcpServers()).find((s) => s.name === COMPOSIO_MCP_NAME);
  return json({
    exists: Boolean(cfg.mcp && panel),
    panelServerId: panel?.id ?? null,
    enabledInPanel: panel?.enabled ?? false,
    url: panel?.url ?? null,
    secretBearing: panel ? SECRET_BEARING.test(panel.url) : false,
    authHeader: "x-api-key (your Composio API key)",
  });
});

export const POST = ownerRoute(async () => {
  enforceRateLimit("connect");
  const out = await ensureComposioMcp(await client());
  invalidateExternalTools();
  return json({ ok: true, ...out, secretBearing: SECRET_BEARING.test(out.url) });
});

export const DELETE = ownerRoute(async () => {
  enforceRateLimit("connect");
  await removeComposioMcp(await client());
  invalidateExternalTools();
  return json({ ok: true });
});
