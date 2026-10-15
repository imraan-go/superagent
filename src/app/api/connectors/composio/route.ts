import { z } from "zod";
import { ComposioClient } from "@/server/connectors/composio-client";
import { getComposioConfig } from "@/server/connectors/composio-config";
import { connectToolkit } from "@/server/connectors/composio-service";
import { clearComposioCaches } from "@/server/connectors/composio-tools";
import { invalidateExternalTools } from "@/server/connectors/external-tools";
import { composioKeyLast4, deleteComposioKey, getComposioKey, setComposioKey } from "@/server/connectors/store";
import { env } from "@/server/env";
import { parseBody } from "@/server/lib/body";
import { AppError } from "@/server/lib/errors";
import { enforceRateLimit } from "@/server/lib/rate";
import { json, ownerRoute } from "@/server/lib/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Status + connected accounts. Without a key: `{configured:false}` - never an error. The catalog has its own route. */
export const GET = ownerRoute(async () => {
  const key = await getComposioKey();
  if (!key) return json({ configured: false });
  const base = { configured: true, source: key.source, last4: key.source === "settings" ? await composioKeyLast4() : null };
  try {
    const [accounts, cfg] = await Promise.all([new ComposioClient(key.key).listConnectedAccounts(), getComposioConfig()]);
    return json({
      ...base,
      accounts: accounts.map((a) => ({
        id: a.id,
        toolkit: a.toolkit?.slug ?? "?",
        status: a.status ?? "UNKNOWN",
        reason: a.status_reason ?? null,
        scheme: a.auth_config?.auth_scheme ?? null,
        createdAt: a.created_at ?? null,
      })),
      mcp: cfg.mcp ? { serverId: cfg.mcp.serverId } : null,
      triggers: cfg.triggers.length,
      error: null,
    });
  } catch (err) {
    return json({ ...base, accounts: [], mcp: null, triggers: 0, error: err instanceof Error ? err.message : "Composio is unreachable." });
  }
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("setKey"), key: z.string().trim().min(8).max(500) }),
  z.object({ action: z.literal("clearKey") }),
  z.object({
    action: z.literal("connect"),
    toolkit: z.string().trim().regex(/^[a-z0-9_-]{1,64}$/i),
    /** Credential-style toolkits only. Forwarded to Composio; never stored, logged or echoed. */
    credentials: z.record(z.string().max(64), z.string().max(4000)).optional(),
  }),
  z.object({ action: z.literal("disconnect"), accountId: z.string().trim().min(1).max(128) }),
]);

export const POST = ownerRoute(async ({ request }) => {
  const body = await parseBody(request, actionSchema);
  if (body.action === "setKey") {
    enforceRateLimit("keyTest");
    const saved = await setComposioKey(body.key);
    clearComposioCaches();
    invalidateExternalTools();
    return json({ ok: true, last4: saved.last4 });
  }
  if (body.action === "clearKey") {
    await deleteComposioKey();
    clearComposioCaches();
    invalidateExternalTools();
    return json({ ok: true });
  }

  const key = await getComposioKey();
  if (!key) throw new AppError("bad_request", "Add your Composio API key first.");
  enforceRateLimit("connect");
  const client = new ComposioClient(key.key);

  if (body.action === "connect") {
    const callback = `${env.APP_URL.replace(/\/$/, "")}/?settings=connectors&connected=${encodeURIComponent(body.toolkit)}`;
    const res = await connectToolkit(client, body.toolkit, { callbackUrl: callback, credentials: body.credentials });
    invalidateExternalTools();
    return json({ ok: true, ...res });
  }
  await client.disconnect(body.accountId);
  invalidateExternalTools();
  return json({ ok: true });
});
