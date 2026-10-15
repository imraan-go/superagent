import { z } from "zod";
import { ComposioClient } from "@/server/connectors/composio-client";
import { invalidateExternalTools } from "@/server/connectors/external-tools";
import { composioKeyLast4, deleteComposioKey, getComposioKey, setComposioKey } from "@/server/connectors/store";
import { env } from "@/server/env";
import { parseBody } from "@/server/lib/body";
import { AppError } from "@/server/lib/errors";
import { json, ownerRoute } from "@/server/lib/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Status + apps + connected accounts. Without a key: `{configured:false}` — never an error. */
export const GET = ownerRoute(async () => {
  const key = await getComposioKey();
  if (!key) return json({ configured: false });
  const client = new ComposioClient(key.key);
  try {
    const [toolkits, accounts] = await Promise.all([client.listToolkits(), client.listConnectedAccounts()]);
    return json({
      configured: true,
      source: key.source,
      last4: key.source === "settings" ? await composioKeyLast4() : null,
      toolkits: toolkits.map((t) => ({ slug: t.slug, name: t.name ?? t.slug, description: t.meta?.description ?? "" })),
      accounts: accounts.map((a) => ({ id: a.id, toolkit: a.toolkit?.slug ?? "?", status: a.status ?? "UNKNOWN" })),
      error: null,
    });
  } catch (err) {
    return json({
      configured: true,
      source: key.source,
      last4: key.source === "settings" ? await composioKeyLast4() : null,
      toolkits: [],
      accounts: [],
      error: err instanceof Error ? err.message : "Composio is unreachable.",
    });
  }
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("setKey"), key: z.string().trim().min(8).max(500) }),
  z.object({ action: z.literal("clearKey") }),
  z.object({ action: z.literal("connect"), toolkit: z.string().trim().regex(/^[a-z0-9_-]{1,64}$/i) }),
  z.object({ action: z.literal("disconnect"), accountId: z.string().trim().min(1).max(128) }),
]);

export const POST = ownerRoute(async ({ request }) => {
  const body = await parseBody(request, actionSchema);
  if (body.action === "setKey") {
    const saved = await setComposioKey(body.key);
    invalidateExternalTools();
    return json({ ok: true, last4: saved.last4 });
  }
  if (body.action === "clearKey") {
    await deleteComposioKey();
    invalidateExternalTools();
    return json({ ok: true });
  }

  const key = await getComposioKey();
  if (!key) throw new AppError("bad_request", "Add your Composio API key first.");
  const client = new ComposioClient(key.key);

  if (body.action === "connect") {
    const res = await client.connect(body.toolkit, `${env.APP_URL.replace(/\/$/, "")}/`);
    invalidateExternalTools();
    return json({ ok: true, redirectUrl: res.redirectUrl, accountId: res.id });
  }
  await client.disconnect(body.accountId);
  invalidateExternalTools();
  return json({ ok: true });
});
