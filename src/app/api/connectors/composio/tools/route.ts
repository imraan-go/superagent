import { z } from "zod";
import { ComposioClient } from "@/server/connectors/composio-client";
import { getComposioConfig, updateComposioConfig } from "@/server/connectors/composio-config";
import { selectedActions } from "@/server/connectors/composio-schema";
import { getToolkitTools } from "@/server/connectors/composio-tools";
import { invalidateExternalTools } from "@/server/connectors/external-tools";
import { getComposioKey } from "@/server/connectors/store";
import { parseBody, parseQuery } from "@/server/lib/body";
import { AppError } from "@/server/lib/errors";
import { json, ownerRoute } from "@/server/lib/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const toolkitParam = z.string().trim().regex(/^[a-z0-9_-]{1,64}$/i);

async function client(): Promise<ComposioClient> {
  const key = await getComposioKey();
  if (!key) throw new AppError("bad_request", "Add your Composio API key first.");
  return new ComposioClient(key.key);
}

/** A toolkit's tools with the owner's selection, read/write class and schema token estimate. */
export const GET = ownerRoute(async ({ request }) => {
  const { toolkit } = parseQuery(request.url, z.object({ toolkit: toolkitParam }));
  const { rows } = await getToolkitTools(await client(), toolkit);
  const cfg = await getComposioConfig();
  const enabled = new Set(selectedActions(rows, cfg.tools[toolkit]).map((r) => r.slug));
  const tools = rows.map((r) => ({ ...r, enabled: enabled.has(r.slug) }));
  return json({
    toolkit,
    customized: cfg.tools[toolkit] !== undefined,
    tools,
    enabledCount: enabled.size,
    schemaTokens: tools.filter((t) => t.enabled).reduce((n, t) => n + t.schemaTokens, 0),
  });
});

const putSchema = z.object({
  toolkit: toolkitParam,
  /** Exact set of enabled action slugs; `null` resets to the default (read-only tools). */
  enabled: z.array(z.string().max(160)).max(2000).nullable(),
});

export const PUT = ownerRoute(async ({ request }) => {
  const body = await parseBody(request, putSchema);
  if (body.enabled) {
    const { rows } = await getToolkitTools(await client(), body.toolkit);
    const known = new Set(rows.map((r) => r.slug));
    const unknown = body.enabled.find((s) => !known.has(s));
    if (unknown) throw new AppError("bad_request", `Unknown tool ${unknown}.`);
  }
  await updateComposioConfig((c) => {
    const tools = { ...c.tools };
    if (body.enabled) tools[body.toolkit] = body.enabled;
    else delete tools[body.toolkit];
    return { ...c, tools };
  });
  invalidateExternalTools();
  return json({ ok: true });
});
