import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Composio -> panel trigger delivery. Composio signs every delivery with the
 * Standard-Webhooks construction: headers `webhook-id`, `webhook-timestamp`,
 * `webhook-signature` (`v1,<base64>`, possibly several space-separated), where
 * signature = base64(HMAC-SHA256(secret, `${id}.${timestamp}.${rawBody}`)).
 * Pure module, unit-tested.
 */
export const COMPOSIO_TOLERANCE_S = 300;

function candidates(secret: string): Buffer[] {
  const keys = [Buffer.from(secret)];
  if (secret.startsWith("whsec_")) {
    const decoded = Buffer.from(secret.slice(6), "base64");
    if (decoded.length > 0) keys.push(decoded);
  }
  return keys;
}

export function verifyComposioSignature(args: {
  secret: string;
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  rawBody: string;
  nowMs?: number;
}): boolean {
  const { id, timestamp, signature } = args;
  if (!id || !timestamp || !signature || !/^\d{1,12}$/.test(timestamp)) return false;
  const now = Math.floor((args.nowMs ?? Date.now()) / 1000);
  if (Math.abs(now - Number(timestamp)) > COMPOSIO_TOLERANCE_S) return false;

  const given = signature
    .split(" ")
    .map((s) => (s.includes(",") ? s.slice(s.indexOf(",") + 1) : s).trim())
    .filter(Boolean);
  for (const key of candidates(args.secret)) {
    const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${args.rawBody}`).digest("base64");
    for (const g of given) {
      const a = Buffer.from(expected);
      const b = Buffer.from(g);
      if (a.length === b.length && timingSafeEqual(a, b)) return true;
    }
  }
  return false;
}

/** Pulls the routing fields out of a V3 envelope; `null` when it is not a trigger message. */
export function parseTriggerEnvelope(raw: string): { triggerId: string; slug: string | null } | null {
  try {
    const body = JSON.parse(raw) as { type?: unknown; metadata?: { trigger_id?: unknown; trigger_slug?: unknown } };
    const triggerId = body.metadata?.trigger_id;
    if (typeof triggerId !== "string" || !triggerId) return null;
    const slug = body.metadata?.trigger_slug;
    return { triggerId, slug: typeof slug === "string" ? slug : null };
  } catch {
    return null;
  }
}
