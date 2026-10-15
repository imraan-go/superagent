import { createWebhook, createWebhookSchema, listWebhooks } from "@/server/automation/webhooks";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER } from "@/server/automation/webhook-signature";
import { parseBody } from "@/server/lib/body";
import { json, ownerRoute } from "@/server/lib/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = ownerRoute(async () =>
  json({ webhooks: await listWebhooks(), headers: { signature: SIGNATURE_HEADER, timestamp: TIMESTAMP_HEADER } }),
);

/** The response is the only time the signing secret is ever shown. */
export const POST = ownerRoute(async ({ request }) => {
  const created = await createWebhook(await parseBody(request, createWebhookSchema));
  return json(created, { status: 201 });
});
