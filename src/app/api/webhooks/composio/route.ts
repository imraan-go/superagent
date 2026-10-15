import { clientIp } from "@/server/auth/rate-limit";
import { fireWebhook } from "@/server/automation/webhooks";
import { ReplayGuard, WindowLimiter } from "@/server/automation/webhook-signature";
import { db } from "@/server/db";
import { webhooks } from "@/server/db/schema";
import { getComposioConfig, openSecret } from "@/server/connectors/composio-config";
import { parseTriggerEnvelope, verifyComposioSignature } from "@/server/connectors/composio-webhook";
import { logger } from "@/server/lib/logger";
import { json } from "@/server/lib/route";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUBLIC inbound endpoint for Composio trigger deliveries (Standard-Webhooks
 * signature, see composio-webhook.ts). No owner session: authenticated solely
 * by the HMAC with the sealed subscription secret + a 5-minute timestamp
 * window + replay memory + rate limits + a body cap. A verified event looks up
 * the panel webhook mapped to its trigger instance and fires it through the
 * same path as /api/webhooks/[id] (payload wrapped as untrusted data, unattended
 * budget guard in startPromptRun). Every failure is opaque.
 */
const MAX_BODY_BYTES = 256 * 1024;
const g = globalThis as unknown as { __fdCmpLimiter?: WindowLimiter; __fdCmpReplay?: ReplayGuard };
const perIp = (g.__fdCmpLimiter ??= new WindowLimiter(60, 60_000));
const replay = (g.__fdCmpReplay ??= new ReplayGuard());

const deny = (status: number, code: string, message: string) => json({ error: { code, message } }, { status });

export async function POST(request: Request): Promise<Response> {
  if (!perIp.allow(clientIp(request.headers))) return deny(429, "rate_limited", "Too many requests.");
  if (Number(request.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) return deny(413, "bad_request", "Payload too large.");
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return deny(413, "bad_request", "Payload too large.");

  const cfg = await getComposioConfig();
  const secret = cfg.subscription ? openSecret(cfg.subscription.secretEnc) : null;
  if (!secret) return deny(404, "not_found", "Unknown webhook.");

  const id = request.headers.get("webhook-id");
  const ok = verifyComposioSignature({
    secret,
    id,
    timestamp: request.headers.get("webhook-timestamp"),
    signature: request.headers.get("webhook-signature"),
    rawBody: raw,
  });
  if (!ok) {
    logger.warn("composio-webhook", { msg: "rejected" });
    return deny(401, "unauthorized", "Invalid signature.");
  }
  if (!replay.firstSeen(`composio:${id}`)) return deny(409, "conflict", "Replayed request.");

  const env = parseTriggerEnvelope(raw);
  const mapped = env ? cfg.triggers.find((t) => t.triggerId === env.triggerId) : undefined;
  // Verified but not ours (other event types, deleted trigger): acknowledge so Composio does not retry.
  if (!mapped) return json({ ok: true, ignored: true }, { status: 202 });

  const [hook] = await db.select().from(webhooks).where(eq(webhooks.id, mapped.webhookId)).limit(1);
  if (!hook || !hook.enabled) return json({ ok: true, ignored: true }, { status: 202 });
  try {
    const result = await fireWebhook(hook, raw);
    logger.info("composio-webhook", { msg: "fired", trigger: mapped.slug, kind: result.kind });
    return json({ ok: true, ...result }, { status: 202 });
  } catch (err) {
    logger.warn("composio-webhook", { msg: "fire failed", detail: String(err) });
    return deny(502, "tool_failed", "The webhook target failed to start.");
  }
}
