import type { ComposioToolkit } from "./composio-client";

/**
 * Pure catalog helpers (no I/O): normalise Composio toolkits into the browser
 * rows, pin the owner's priority set, filter and page.
 */
export interface CatalogToolkit {
  slug: string;
  name: string;
  description: string;
  logo: string | null;
  categories: string[];
  authSchemes: string[];
  /** True when Composio hosts the OAuth app, so the owner needs no developer account. */
  managedAuth: boolean;
  noAuth: boolean;
  toolsCount: number;
  triggersCount: number;
  authGuideUrl: string | null;
  pinned: boolean;
}

/** Owner's priority apps, in display order. Slugs are Composio toolkit slugs (the first match in a group wins per slug). */
export const PRIORITY_TOOLKITS: ReadonlyArray<readonly string[]> = [
  ["gmail"],
  ["googledrive"],
  ["googlecalendar"],
  ["googledocs"],
  ["googlesheets"],
  ["notion"],
  ["linkedin"],
  ["whatsapp"],
  ["slack"],
  ["github"],
  ["facebook"],
  ["instagram"],
  ["metaads", "meta_ads"],
  ["twitter"],
  ["outlook"],
  ["hubspot"],
];

const PRIORITY_INDEX = new Map<string, number>(PRIORITY_TOOLKITS.flatMap((g, i) => g.map((s) => [s, i] as const)));

export function normalizeToolkit(t: ComposioToolkit): CatalogToolkit {
  return {
    slug: t.slug,
    name: t.name ?? t.slug,
    description: t.meta?.description ?? "",
    logo: t.meta?.logo ?? null,
    categories: (t.meta?.categories ?? []).map((c) => c.name),
    authSchemes: t.auth_schemes ?? [],
    managedAuth: (t.composio_managed_auth_schemes ?? []).length > 0,
    noAuth: t.no_auth === true,
    toolsCount: t.meta?.tools_count ?? 0,
    triggersCount: t.meta?.triggers_count ?? 0,
    authGuideUrl: t.auth_guide_url ?? null,
    pinned: PRIORITY_INDEX.has(t.slug.toLowerCase()),
  };
}

/** Priority set first (in the owner's order), then the rest in Composio's usage order. */
export function orderCatalog(list: CatalogToolkit[]): CatalogToolkit[] {
  const pinned = list
    .filter((t) => t.pinned)
    .sort((a, b) => (PRIORITY_INDEX.get(a.slug.toLowerCase()) ?? 99) - (PRIORITY_INDEX.get(b.slug.toLowerCase()) ?? 99));
  return [...pinned, ...list.filter((t) => !t.pinned)];
}

export interface CatalogQuery {
  search?: string | undefined;
  category?: string | undefined;
  offset?: number | undefined;
  limit?: number | undefined;
}

export function queryCatalog(all: CatalogToolkit[], q: CatalogQuery): { items: CatalogToolkit[]; total: number } {
  const needle = (q.search ?? "").trim().toLowerCase();
  const filtered = all.filter((t) => {
    if (q.category && !t.categories.some((c) => c.toLowerCase() === q.category!.toLowerCase())) return false;
    if (!needle) return true;
    return `${t.slug} ${t.name} ${t.description}`.toLowerCase().includes(needle);
  });
  // While searching, name matches outrank description matches; pinned order otherwise.
  if (needle) {
    filtered.sort((a, b) => Number(b.name.toLowerCase().includes(needle)) - Number(a.name.toLowerCase().includes(needle)));
  }
  const offset = q.offset ?? 0;
  return { items: filtered.slice(offset, offset + (q.limit ?? 48)), total: filtered.length };
}

export function categoriesOf(all: CatalogToolkit[]): string[] {
  const counts = new Map<string, number>();
  for (const t of all) for (const c of t.categories) counts.set(c, (counts.get(c) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c]) => c);
}
