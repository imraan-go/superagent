import "server-only";
import { ComposioClient } from "./composio-client";
import type { ComposioToolkit } from "./composio-client";
import { normalizeToolkit, orderCatalog } from "./composio-catalog";
import type { CatalogToolkit } from "./composio-catalog";
import { slimSchema, toolRow } from "./composio-schema";
import type { ToolRow } from "./composio-schema";

/** 1 h server-side caches (ADR-04: single instance, so process memory is enough). */
const TTL_MS = 60 * 60 * 1000;

interface Cached<T> {
  at: number;
  value: T;
}
const g = globalThis as unknown as {
  __fdComposioCatalog?: Cached<{ toolkits: CatalogToolkit[]; categories: string[] }>;
  __fdComposioTools?: Map<string, Cached<ToolkitTools>>;
};

export function clearComposioCaches(): void {
  g.__fdComposioCatalog = undefined;
  g.__fdComposioTools = undefined;
}

export async function getCatalog(client: ComposioClient, force = false): Promise<{ toolkits: CatalogToolkit[]; categories: string[] }> {
  const c = g.__fdComposioCatalog;
  if (!force && c && Date.now() - c.at < TTL_MS) return c.value;
  const raw: ComposioToolkit[] = await client.listAllToolkits();
  const seen = new Set<string>();
  const toolkits = orderCatalog(raw.map(normalizeToolkit).filter((t) => (seen.has(t.slug) ? false : (seen.add(t.slug), true))));
  const categories = [...new Set(toolkits.flatMap((t) => t.categories))].sort();
  g.__fdComposioCatalog = { at: Date.now(), value: { toolkits, categories } };
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
