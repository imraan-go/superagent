import { z } from "zod";
import { ComposioClient } from "@/server/connectors/composio-client";
import { getComposioConfig } from "@/server/connectors/composio-config";
import { composioWebhookUrl, disableTrigger, enableTrigger } from "@/server/connectors/composio-service";
import { getComposioKey } from "@/server/connectors/store";
import { parseBody } from "@/server/lib/body";
import { AppError } from "@/server/lib/errors";
import { enforceRateLimit } from "@/server/lib/rate";
import { json, ownerRoute } from "@/server/lib/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function client(): Promise<ComposioClient> {
  const key = await getComposioKey();
  if (!key) throw new AppError("bad_request", "Add your Composio API key first.");
  return new ComposioClient(key.key);
}

/** Trigger types for the owner's connected toolkits + the ones already enabled. */
export const GET = ownerRoute(async () => {
  const c = await client();
  const accounts = (await c.listConnectedAccounts()).filter((a) => (a.status ?? "").toUpperCase() === "ACTIVE");
  const toolkits = [...new Set(accounts.map((a) => a.toolkit?.slug).filter((s): s is string => Boolean(s)))];
  const [types, cfg] = await Promise.all([c.listTriggerTypes(toolkits), getComposioConfig()]);
  const enabled = new Map(cfg.triggers.map((t) => [t.slug, t] as const));
  return json({
    webhookUrl: composioWebhookUrl(),
    accounts: accounts.map((a) => ({ id: a.id, toolkit: a.toolkit?.slug ?? "?" })),
    types: types.map((t) => ({
      slug: t.slug,
      name: t.name ?? t.slug,
      description: (t.description ?? "").slice(0, 240),
      toolkit: t.toolkit?.slug ?? "?",
      kind: t.type ?? "webhook",
      hasConfig: Object.keys((t.config as { properties?: object } | undefined)?.properties ?? {}).length > 0,
      enabled: enabled.has(t.slug) ? { triggerId: enabled.get(t.slug)!.triggerId, webhookId: enabled.get(t.slug)!.webhookId } : null,
    })),
  });
});

const postSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("enable"),
    slug: z.string().trim().regex(/^[A-Z0-9_]{3,120}$/),
    toolkit: z.string().trim().regex(/^[a-z0-9_-]{1,64}$/i),
    connectedAccountId: z.string().trim().min(1).max(128),
    prompt: z.string().trim().min(1).max(8000),
    config: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({ action: z.literal("disable"), triggerId: z.string().trim().min(1).max(128) }),
]);

export const POST = ownerRoute(async ({ request }) => {
  const body = await parseBody(request, postSchema);
  enforceRateLimit("connect");
  const c = await client();
  if (body.action === "enable") {
    const out = await enableTrigger(c, body);
    return json({ ok: true, ...out });
  }
  await disableTrigger(c, body.triggerId);
  return json({ ok: true });
});
