import { createHash, randomBytes } from 'node:crypto';

/** Deterministic JSON: sorted object keys, no undefined, NaN/Infinity rejected. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('non-finite numbers cannot be canonicalized');
    return value;
  }
  if (typeof value === 'string') return value.normalize('NFC');
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = normalize(v);
    }
    return out;
  }
  throw new Error(`cannot canonicalize ${typeof value}`);
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

export function newNonce(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * Everything an approval is bound to. Changing any field produces a different hash and
 * therefore requires a fresh approval.
 */
export interface IntentBinding {
  ownerId: string;
  taskId: string;
  toolSlug: string;
  toolVersion: string;
  connectedAccountId: string | null;
  args: unknown;
  destination: unknown;
  attachments: Array<{ sha256: string; name: string }>;
  nonce: string;
  expiresAtMs: number;
}

export function intentHash(binding: IntentBinding): string {
  return sha256Hex(canonicalJson({ v: 1, ...binding }));
}
