import { verifiedConnectorTools } from '@superagent/policy';
import { ComposioClient } from './client';
import type { ComposioToolkit } from './client';
import { buildDetail, facetsOf, findToolkit, normalizeToolkit, orderCatalog } from './catalog';
import type { CatalogToolkit, Facet, ToolkitDetail } from './catalog';
import { composioActionName, isComposioReadAction } from './naming';

/** Catalog caches: the Composio catalog changes rarely and is the same for every user. */
const TTL_MS = 60 * 60 * 1000;

interface Cached<T> {
  at: number;
  value: T;
}

export interface CatalogData {
  toolkits: CatalogToolkit[];
  categories: string[];
  facets: Facet[];
  upstreamTotal: number | null;
}

export interface ToolRow {
  slug: string;
  action: string;
  name: string;
  description: string;
  readOnly: boolean;
  schemaTokens: number;
}

let catalogCache: Cached<CatalogData> | undefined;
const toolsCache = new Map<string, Cached<ToolRow[]>>();
const triggersCache = new Map<
  string,
  Cached<
    Array<{ slug: string; name?: string | undefined; description?: string | undefined; type?: string | undefined }>
  >
>();

/**
 * Toolkits the agent can actually use on this installation: those with at least one curated tool
 * that `pnpm composio:discover` verified (packages/policy connector-catalog.lock.json).
 */
export function supportedToolkits(): Set<string> {
  return new Set(
    verifiedConnectorTools()
      .map((t) => t.toolkit!)
      .filter(Boolean),
  );
}

export async function getCatalog(client: ComposioClient, force = false): Promise<CatalogData> {
  if (!force && catalogCache && Date.now() - catalogCache.at < TTL_MS) return catalogCache.value;
  const { items: raw, total }: { items: ComposioToolkit[]; total: number | null } =
    await client.listAllToolkitsWithTotal();
  const seen = new Set<string>();
  const supported = supportedToolkits();
  // Apps the agent can use sort first ("pinned"), then Composio's own usage order.
  const toolkits = orderCatalog(
    raw
      .map(normalizeToolkit)
      .filter((t) => (seen.has(t.slug) ? false : (seen.add(t.slug), true)))
      .map((t) => ({ ...t, pinned: supported.has(t.slug) })),
  );
  const facets = facetsOf(toolkits);
  catalogCache = {
    at: Date.now(),
    value: { toolkits, categories: facets.map((f) => f.name), facets, upstreamTotal: total },
  };
  return catalogCache.value;
}

export async function getToolkitTools(client: ComposioClient, toolkit: string): Promise<ToolRow[]> {
  const hit = toolsCache.get(toolkit);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const tools = await client.listTools(toolkit);
  const rows = tools.map((t) => {
    const action = composioActionName(t.slug, toolkit);
    return {
      slug: t.slug,
      action,
      name: t.name ?? t.slug,
      description: (t.description ?? '').slice(0, 200),
      readOnly: isComposioReadAction(action),
      schemaTokens: Math.ceil(JSON.stringify(t.input_parameters ?? {}).length / 4),
    };
  });
  toolsCache.set(toolkit, { at: Date.now(), value: rows });
  return rows;
}

/**
 * One toolkit with its tools and triggers. `enabled` marks the tools the agent may call here (the
 * verified curated set); every other tool is listed for information only. Writes always stop for
 * the owner's exact approval.
 */
export async function getToolkitDetail(client: ComposioClient, slug: string): Promise<ToolkitDetail | null> {
  const catalog = await getCatalog(client);
  const toolkit = findToolkit(catalog.toolkits, slug);
  if (!toolkit) return null;
  let triggers = triggersCache.get(toolkit.slug);
  if (!triggers || Date.now() - triggers.at >= TTL_MS) {
    triggers = {
      at: Date.now(),
      value: toolkit.triggersCount > 0 ? await client.listTriggerTypes([toolkit.slug]).catch(() => []) : [],
    };
    triggersCache.set(toolkit.slug, triggers);
  }
  const rows = await getToolkitTools(client, toolkit.slug);
  const verified = verifiedConnectorTools().filter((t) => t.toolkit === toolkit.slug);
  const enabled = new Set(verified.map((t) => t.composioSlug!));
  const detail = buildDetail(toolkit, rows, triggers.value, enabled, true);
  // Approval comes from the application's classification, not from the tool's name.
  const writes = new Set(verified.filter((t) => t.classification === 'external_write').map((t) => t.composioSlug!));
  return {
    ...detail,
    tools: detail.tools.map((t) =>
      enabled.has(t.slug) ? { ...t, needsApproval: writes.has(t.slug), readOnly: !writes.has(t.slug) } : t,
    ),
  };
}
