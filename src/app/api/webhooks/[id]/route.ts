import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { webhooks } from "@/server/db/schema";
import { unseal } from "@/server/lib/crypto";
import { logger } from "@/server/lib/logger";
import { json } from "@/server/lib/route";
import { clientIp } from "@/server/auth/rate-limit";
import { fireWebhook } from "@/server/automation/webhooks";
import {
  ReplayGuard,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  WindowLimiter,
  verifySignature,
} from "@/server/automation/webhook-signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUBLIC inbound webhook. No owner session: authenticated solely by
 * HMAC-SHA256 over `${timestamp}.${rawBody}` with the hook's sealed secret,
 * a ±5-minute timestamp window, a replay memory, per-hook and per-IP rate
 * limits and a body-size cap. Excluded from the session gate and CSRF guard in
 * src/proxy.ts. Every failure returns the same opaque 401/404 shape.
 */
const MAX_BODY_BYTES = 256 * 1024;
const g = globalThis as unknown as {
  __fdHookLimiter?: WindowLimiter;
  __fdHookIpLimiter?: WindowLimiter;
  __fdHookReplay?: ReplayGuard;
};
const perHook = (g.__fdHookLimiter ??= new WindowLimiter(30, 60_000));
const perIp = (g.__fdHookIpLimiter ??= new WindowLimiter(60, 60_000));
const replay = (g.__fdHookReplay ??= new ReplayGuard());

type Ctx = { params: Promise<{ id: string }> };

const deny = (status: number, code: string, message: string) =>
  json({ error: { code, message } }, { status });

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const ip = clientIp(request.headers);

  if (!perIp.allow(ip)) return deny(429, "rate_limited", "Too many requests.");
  if (!z.uuid().safeParse(id).success) return deny(404, "not_found", "Unknown webhook.");

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return deny(413, "bad_request", "Payload too large.");

  // Read with a hard cap even if content-length lied.
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return deny(413, "bad_request", "Payload too large.");
      }
      chunks.push(value);
    }
  }
  const raw = Buffer.concat(chunks);

  const [hook] = await db.select().from(webhooks).where(eq(webhooks.id, id)).limit(1);
  if (!hook || !hook.enabled) return deny(404, "not_found", "Unknown webhook.");
  if (!perHook.allow(hook.id)) return deny(429, "rate_limited", "Too many requests.");

  let secret: string;
  try {
    secret = unseal(hook.secretEnc);
  } catch {
    logger.error("webhook", { id, msg: "secret failed to decrypt" });
    return deny(500, "internal", "Webhook misconfigured.");
  }

  const signature = request.headers.get(SIGNATURE_HEADER);
  const verdict = verifySignature({
    secret,
    rawBody: raw,
    signature,
    timestamp: request.headers.get(TIMESTAMP_HEADER),
  });
  if (!verdict.ok) {
    logger.warn("webhook", { id, msg: "rejected", reason: verdict.reason });
    return deny(401, "unauthorized", "Invalid signature.");
  }
  if (!replay.firstSeen(`${hook.id}:${signature}`)) return deny(409, "conflict", "Replayed request.");

  try {
    const result = await fireWebhook(hook, raw.toString("utf8"));
    logger.info("webhook", { id, msg: "fired", kind: result.kind });
    return json({ ok: true, ...result }, { status: 202 });
  } catch (err) {
    logger.warn("webhook", { id, msg: "fire failed", detail: String(err) });
    return deny(502, "tool_failed", "The webhook target failed to start.");
  }
}
