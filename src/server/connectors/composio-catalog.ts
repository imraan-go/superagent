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

export const OTHER_CATEGORY = "Other";

/** Tool names carry `_` where Composio slugs may carry `-` or nothing; compare on letters+digits only. */
export function normSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Exact slug first, then the model-facing normalised form (`google_drive` -> `googledrive`). */
export function findToolkit<T extends { slug: string }>(all: T[], slug: string): T | undefined {
  return all.find((t) => t.slug === slug) ?? all.find((t) => normSlug(t.slug) === normSlug(slug));
}

export function normalizeToolkit(t: ComposioToolkit): CatalogToolkit {
  const named = (t.meta?.categories ?? []).map((c) => c.name).filter(Boolean);
  return {
    slug: t.slug,
    name: t.name ?? t.slug,
    description: t.meta?.description ?? "",
    logo: t.meta?.logo ?? null,
    // Every toolkit lands in at least one category so no app is unreachable by browsing.
    categories: named.length > 0 ? named : [OTHER_CATEGORY],
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
  /** Restrict to these slugs (Manage view). */
  slugs?: readonly string[] | undefined;
  offset?: number | undefined;
  limit?: number | undefined;
}

/** Lower is better. Name-prefix beats name-contains beats slug beats description; every token must match somewhere. */
export function searchRank(t: CatalogToolkit, needle: string): number | null {
  const name = t.name.toLowerCase();
  const slug = t.slug.toLowerCase();
  const desc = t.description.toLowerCase();
  const compact = normSlug(needle);
  const tokens = needle.split(/\s+/).filter(Boolean);
  const hay = `${slug} ${name} ${desc} ${t.categories.join(" ").toLowerCase()}`;
  if (!tokens.every((tok) => hay.includes(tok)) && !(compact && normSlug(`${slug}${name}`).includes(compact))) return null;
  if (name === needle || slug === compact) return 0;
  if (name.startsWith(needle) || slug.startsWith(compact)) return 1;
  if (name.includes(needle) || normSlug(name).includes(compact)) return 2;
  if (slug.includes(compact)) return 3;
  if (tokens.every((tok) => name.includes(tok))) return 4;
  return 5;
}

export function queryCatalog(all: CatalogToolkit[], q: CatalogQuery): { items: CatalogToolkit[]; total: number } {
  const needle = (q.search ?? "").trim().toLowerCase();
  const cat = q.category?.toLowerCase();
  const only = q.slugs ? new Set(q.slugs.map(normSlug)) : null;
  let rows: Array<{ t: CatalogToolkit; rank: number }> = [];
  for (const t of all) {
    if (cat && !t.categories.some((c) => c.toLowerCase() === cat)) continue;
    if (only && !only.has(normSlug(t.slug))) continue;
    if (!needle) {
      rows.push({ t, rank: 0 });
      continue;
    }
    const rank = searchRank(t, needle);
    if (rank !== null) rows.push({ t, rank });
  }
  // Stable sort keeps the catalog order (priority set, then usage) within a rank.
  if (needle) rows = rows.map((r, i) => ({ ...r, i })).sort((a, b) => a.rank - b.rank || a.i - b.i);
  const offset = q.offset ?? 0;
  return { items: rows.slice(offset, offset + (q.limit ?? 48)).map((r) => r.t), total: rows.length };
}

/** Category names, most populated first. */
export function categoriesOf(all: CatalogToolkit[]): string[] {
  return facetsOf(all).map((f) => f.name);
}

export interface Facet {
  name: string;
  count: number;
}

export function facetsOf(all: CatalogToolkit[]): Facet[] {
  const counts = new Map<string, number>();
  for (const t of all) for (const c of t.categories) counts.set(c, (counts.get(c) ?? 0) + 1);
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => (a.name === OTHER_CATEGORY ? 1 : b.name === OTHER_CATEGORY ? -1 : b.count - a.count || a.name.localeCompare(b.name)));
}

export interface CatalogSections {
  recommended: CatalogToolkit[];
  sections: Array<{ category: string; count: number; items: CatalogToolkit[] }>;
}

/** Browse view: the owner's priority apps, then the top few of every category (each with its full count for "View all"). */
export function buildSections(all: CatalogToolkit[], perSection = 6): CatalogSections {
  const recommended = all.filter((t) => t.pinned);
  const facets = facetsOf(all);
  return {
    recommended,
    sections: facets.map((f) => ({
      category: f.name,
      count: f.count,
      items: all.filter((t) => t.categories.includes(f.name)).slice(0, perSection),
    })),
  };
}

/* ---------------------------------------------------------- detail -- */

export interface DetailTool {
  slug: string;
  action: string;
  name: string;
  description: string;
  readOnly: boolean;
  /** Writes always stop for the owner's approval before they run. */
  needsApproval: boolean;
  enabled: boolean;
}

export interface DetailTrigger {
  slug: string;
  name: string;
  description: string;
  kind: string;
}

export interface ToolkitDetail {
  toolkit: CatalogToolkit;
  tools: DetailTool[];
  enabledCount: number;
  customized: boolean;
  triggers: DetailTrigger[];
  /** Composio's own page for the toolkit. */
  composioUrl: string;
}

/** Pure join of the catalog entry, the tool rows, trigger types and the owner's enabled-set. */
export function buildDetail(
  toolkit: CatalogToolkit,
  rows: Array<{ slug: string; action: string; name: string; description: string; readOnly: boolean }>,
  triggers: Array<{ slug: string; name?: string | undefined; description?: string | undefined; type?: string | undefined }>,
  enabled: ReadonlySet<string>,
  customized: boolean,
): ToolkitDetail {
  const tools = rows.map((r) => ({ ...r, needsApproval: !r.readOnly, enabled: enabled.has(r.slug) })).sort((a, b) => Number(b.readOnly) - Number(a.readOnly));
  return {
    toolkit,
    tools,
    enabledCount: tools.filter((t) => t.enabled).length,
    customized,
    triggers: triggers.map((t) => ({
      slug: t.slug,
      name: t.name ?? t.slug,
      description: (t.description ?? "").slice(0, 280),
      kind: t.type ?? "webhook",
    })),
    composioUrl: `https://composio.dev/toolkits/${encodeURIComponent(toolkit.slug.toLowerCase())}`,
  };
}
