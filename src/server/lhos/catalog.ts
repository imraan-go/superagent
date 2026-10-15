import "server-only";
import { lhos } from "./client";
import type { ToolDef } from "./types";

/**
 * In-process cache of `GET /api/tools` — one 43 KB document with no
 * pagination, fetched on nearly every run (docs/API_REFERENCE.md).
 *
 * Process-local is correct here because the panel runs a single instance by
 * design (ADR-04). Concurrent callers share one in-flight request rather than
 * each triggering their own fetch.
 */
const TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  tools: ToolDef[];
  fetchedAt: number;
}

const globalForCatalog = globalThis as unknown as {
  __fdToolCache?: CacheEntry;
  __fdToolInflight?: Promise<ToolDef[]>;
};

export async function getToolCatalog(options?: { force?: boolean }): Promise<ToolDef[]> {
  const cached = globalForCatalog.__fdToolCache;
  if (!options?.force && cached && Date.now() - cached.fetchedAt < TTL_MS) {
    return cached.tools;
  }

  const inflight = globalForCatalog.__fdToolInflight;
  if (inflight && !options?.force) return inflight;

  const request = lhos
    .getTools()
    .then((tools) => {
      globalForCatalog.__fdToolCache = { tools, fetchedAt: Date.now() };
      return tools;
    })
    .finally(() => {
      globalForCatalog.__fdToolInflight = undefined;
    });

  globalForCatalog.__fdToolInflight = request;

  try {
    return await request;
  } catch (err) {
    // A stale catalogue beats failing the run outright — tool schemas are
    // stable and the agent server may simply be waking up.
    if (cached) return cached.tools;
    throw err;
  }
}

export function getCachedCatalogAge(): number | null {
  const cached = globalForCatalog.__fdToolCache;
  return cached ? Date.now() - cached.fetchedAt : null;
}
