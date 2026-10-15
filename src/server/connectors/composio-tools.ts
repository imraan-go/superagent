import "server-only";
import { AppError } from "@/server/lib/errors";
import { ComposioClient } from "./composio-client";
import type { ComposioToolkit } from "./composio-client";
import { buildDetail, facetsOf, findToolkit, normalizeToolkit, orderCatalog } from "./composio-catalog";
import type { CatalogToolkit, Facet, ToolkitDetail } from "./composio-catalog";
import { selectedActions, slimSchema, toolRow } from "./composio-schema";
import type { ToolRow } from "./composio-schema";

/** 1 h server-side caches (ADR-04: single instance, so process memory is enough). */
const TTL_MS = 60 * 60 * 1000;

interface Cached<T> {
  at: number;
  value: T;
}
const g = globalThis as unknown as {
  __fdComposioCatalog?: Cached<CatalogData>;
  __fdComposioDetail?: Map<string, Cached<StaticDetail>>;
  __fdComposioTools?: Map<string, Cached<ToolkitTools>>;
};

export interface CatalogData {
  toolkits: CatalogToolkit[];
  categories: string[];
  facets: Facet[];
  /** Composio's own `total_items`; null if the API did not report one. */
  upstreamTotal: number | null;
}

export function clearComposioCaches(): void {
  g.__fdComposioDetail = undefined;
  g.__fdComposioCatalog = undefined;
  g.__fdComposioTools = undefined;
}

export async function getCatalog(client: ComposioClient, force = false): Promise<CatalogData> {
  const c = g.__fdComposioCatalog;
  if (!force && c && Date.now() - c.at < TTL_MS) return c.value;
  const { items: raw, total }: { items: ComposioToolkit[]; total: number | null } = await client.listAllToolkitsWithTotal();
  const seen = new Set<string>();
  const toolkits = orderCatalog(raw.map(normalizeToolkit).filter((t) => (seen.has(t.slug) ? false : (seen.add(t.slug), true))));
  const facets = facetsOf(toolkits);
  g.__fdComposioCatalog = { at: Date.now(), value: { toolkits, categories: facets.map((f) => f.name), facets, upstreamTotal: total } };
  return g.__fdComposioCatalog.value;
}

/** A toolkit's tools (rows for the UI + the slimmed schemas for the model). */
export interface ToolkitTools {
  rows: ToolRow[];
  schemas: Map<string, unknown>;
}

export async function getToolkitTools(client: ComposioClient, toolkit: string, force = false): Promise<ToolkitTools> {
  const cache = (g.__fdComposioTools ??= new Map());
  const hit = cache.get(toolkit);
  if (!force && hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const tools = await client.listTools(toolkit);
  const value = {
    rows: tools.map((t) => toolRow(toolkit, t)),
    schemas: new Map(tools.map((t) => [t.slug, slimSchema(t.input_parameters ?? { type: "object", properties: {} })] as const)),
  };
  cache.set(toolkit, { at: Date.now(), value });
  return value;
}

/** The parts of a toolkit detail that do not depend on the owner's settings (cached 1 h). */
interface StaticDetail {
  toolkit: CatalogToolkit;
  triggers: Array<{ slug: string; name?: string | undefined; description?: string | undefined; type?: string | undefined }>;
}

/**
 * Toolkit + its tools + its triggers in one call. The catalog entry, tools and
 * trigger types are cached; the owner's enabled-tool selection is joined fresh
 * so a toggle is reflected immediately.
 */
export async function getToolkitDetail(
  client: ComposioClient,
  slug: string,
  enabledFor: (toolkit: string) => Promise<readonly string[] | undefined> = async () => undefined,
): Promise<ToolkitDetail> {
  const catalog = await getCatalog(client);
  const toolkit = findToolkit(catalog.toolkits, slug);
  if (!toolkit) throw new AppError("not_found", `No Composio toolkit "${slug}".`);
  const cache = (g.__fdComposioDetail ??= new Map());
  let hit = cache.get(toolkit.slug);
  if (!hit || Date.now() - hit.at >= TTL_MS) {
    const triggers = toolkit.triggersCount > 0 ? await client.listTriggerTypes([toolkit.slug]) : [];
    hit = { at: Date.now(), value: { toolkit, triggers } };
    cache.set(toolkit.slug, hit);
  }
  const { rows } = await getToolkitTools(client, toolkit.slug);
  const saved = await enabledFor(toolkit.slug);
  const enabled = new Set(selectedActions(rows, saved).map((r) => r.slug));
  return buildDetail(toolkit, rows, hit.value.triggers, enabled, saved !== undefined);
}
