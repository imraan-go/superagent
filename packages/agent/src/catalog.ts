import { z } from 'zod';

/** Public Vercel AI Gateway model listing (OpenAI-compatible); includes capability tags and pricing. */
export const GATEWAY_MODELS_URL = 'https://ai-gateway.vercel.sh/v1/models';

const Entry = z.object({
  id: z.string(),
  type: z.string().optional(),
  tags: z.array(z.string()).optional().default([]),
  context_window: z.number().optional(),
  max_tokens: z.number().optional(),
  pricing: z
    .object({
      input: z.string(),
      output: z.string(),
      input_cache_read: z.string().optional(),
      input_cache_write: z.string().optional(),
    })
    .passthrough()
    .optional(),
});
export type CatalogEntry = z.infer<typeof Entry>;

export type Capability = 'tool-use' | 'vision' | 'structured-output';

let cache: { at: number; entries: Map<string, CatalogEntry> } | undefined;

export async function fetchGatewayCatalog(
  fetchImpl: typeof fetch = fetch,
  ttlMs = 3_600_000,
): Promise<Map<string, CatalogEntry>> {
  if (cache && Date.now() - cache.at < ttlMs) return cache.entries;
  const res = await fetchImpl(GATEWAY_MODELS_URL, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Gateway catalogue request failed: HTTP ${res.status}`);
  const body = z.object({ data: z.array(z.unknown()) }).parse(await res.json());
  const entries = new Map<string, CatalogEntry>();
  for (const raw of body.data) {
    const e = Entry.safeParse(raw);
    if (e.success) entries.set(e.data.id, e.data);
  }
  cache = { at: Date.now(), entries };
  return entries;
}

export interface ModelCheck {
  modelId: string;
  ok: boolean;
  problems: string[];
  entry?: CatalogEntry;
}

/**
 * A configured slug must be on the explicit allowlist, present in the live catalogue, a language
 * model, and tagged with every capability the call site needs. No silent substitution.
 */
export function checkModel(
  catalog: Map<string, CatalogEntry>,
  modelId: string | undefined,
  allowlist: string[],
  required: Capability[],
): ModelCheck {
  if (!modelId) return { modelId: '(unset)', ok: false, problems: ['model is not configured'] };
  const problems: string[] = [];
  if (!allowlist.includes(modelId)) problems.push('not on AI_MODEL_ALLOWLIST');
  const entry = catalog.get(modelId);
  if (!entry) return { modelId, ok: false, problems: [...problems, 'not present in the current Gateway catalogue'] };
  if (entry.type && entry.type !== 'language') problems.push(`type is ${entry.type}, not language`);
  for (const cap of required) if (!entry.tags.includes(cap)) problems.push(`missing capability tag "${cap}"`);
  if (!entry.pricing) problems.push('catalogue has no pricing; cost would be unknown');
  return { modelId, ok: problems.length === 0, problems, entry };
}

/** For tests. */
export function primeCatalogCache(entries: CatalogEntry[]): void {
  cache = { at: Date.now(), entries: new Map(entries.map((e) => [e.id, e])) };
}
