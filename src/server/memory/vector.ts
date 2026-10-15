import { createHash } from "node:crypto";

/**
 * Memory vector math. Pure module, unit-tested.
 */
export const EMBEDDING_DIMS = 1536;
/** Above this cosine similarity a new fact is treated as a restatement. */
export const DEDUPE_THRESHOLD = 0.92;

export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function isDuplicate(
  candidate: readonly number[],
  existing: ReadonlyArray<readonly number[]>,
  threshold = DEDUPE_THRESHOLD,
): boolean {
  return existing.some((e) => cosine(candidate, e) > threshold);
}

/**
 * Local fallback embedding when no OpenAI key exists: feature-hashed word and
 * character-trigram counts, L2-normalised. `memories.embedding` is NOT NULL, so
 * this keeps rows storable and gives near-duplicate detection without a vendor.
 * It is *not* semantic — recall without a key leans on keyword + recency.
 */
export function hashEmbedding(text: string, dims = EMBEDDING_DIMS): number[] {
  const v = new Array<number>(dims).fill(0);
  const norm = text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const features: string[] = norm.split(" ").filter(Boolean).map((w) => `w:${w}`);
  const padded = ` ${norm} `;
  for (let i = 0; i + 3 <= padded.length; i += 1) features.push(`t:${padded.slice(i, i + 3)}`);

  for (const f of features) {
    const h = createHash("md5").update(f).digest();
    const idx = h.readUInt32BE(0) % dims;
    v[idx]! += h[4]! & 1 ? 1 : -1;
  }
  const len = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return len === 0 ? v : v.map((x) => x / len);
}

/** Search keywords for the no-embedding recall path. */
export function keywords(text: string, max = 8): string[] {
  const stop = new Set(["the", "and", "for", "with", "that", "this", "what", "have", "from", "your", "you", "are", "can", "please", "about"]);
  const words = text.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ?? [];
  return [...new Set(words.filter((w) => !stop.has(w)))].slice(0, max);
}
