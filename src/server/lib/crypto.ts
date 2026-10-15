import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { env } from "@/server/env";

/**
 * AES-256-GCM sealing for the `secrets` table (rule 30-security).
 *
 * Storage format: base64(iv ‖ authTag ‖ ciphertext) — self-contained, so a row
 * can be decrypted without any side table. The key is PANEL_SECRET_KEY, which
 * means rotating it invalidates every stored secret by design.
 */

const IV_BYTES = 12; // GCM standard nonce length
const TAG_BYTES = 16;

function key(): Buffer {
  const raw = Buffer.from(env.PANEL_SECRET_KEY, "base64");
  // Accept any ≥32-byte key material; derive a fixed 32-byte AES key from it.
  return raw.length === 32 ? raw : createHash("sha256").update(raw).digest();
}

export function seal(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function unseal(sealed: string): string {
  const buf = Buffer.from(sealed, "base64");
  if (buf.length <= IV_BYTES + TAG_BYTES) {
    throw new Error("sealed value is malformed");
  }
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ct = buf.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/** The only part of a credential the UI is ever allowed to render. */
export function last4(value: string): string {
  return value.length <= 4 ? "••••" : value.slice(-4);
}

export function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Constant-time comparison for tokens and signatures. */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
