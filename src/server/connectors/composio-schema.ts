import { composioActionName, isComposioReadAction } from "./naming";

/**
 * Pure helpers that keep Composio tool schemas small enough to hand to the
 * model: drop decoration, clip descriptions, estimate tokens, enforce a budget.
 */
const DROP_KEYS = new Set(["title", "examples", "example", "$schema", "additionalProperties", "format", "deprecated", "readOnly", "writeOnly"]);

export function slimSchema(schema: unknown, depth = 0): unknown {
  if (depth > 6 || schema === null || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.slice(0, 40).map((s) => slimSchema(s, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (DROP_KEYS.has(k)) continue;
    if (k === "description" && typeof v === "string") out[k] = v.length > 140 ? `${v.slice(0, 137)}...` : v;
    else out[k] = slimSchema(v, depth + 1);
  }
  return out;
}

/** ~4 characters per token: a deliberately simple, stable estimate. */
export function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value ?? "").length / 4);
}

export interface ToolLike {
  slug: string;
  name?: string | undefined;
  description?: string | undefined;
  input_parameters?: Record<string, unknown> | undefined;
}

export interface ToolRow {
  slug: string;
  action: string;
  name: string;
  description: string;
  readOnly: boolean;
  schemaTokens: number;
}

export function toolRow(toolkit: string, t: ToolLike): ToolRow {
  const action = composioActionName(t.slug, toolkit);
  const schema = slimSchema(t.input_parameters ?? { type: "object", properties: {} });
  return {
    slug: t.slug,
    action,
    name: t.name ?? t.slug,
    description: (t.description ?? "").slice(0, 200),
    readOnly: isComposioReadAction(action),
    schemaTokens: estimateTokens(schema) + estimateTokens((t.description ?? "").slice(0, 240)) + 12,
  };
}

/** Owner's selection, or the default: read-only tools only. */
export function selectedActions(rows: ToolRow[], enabled: readonly string[] | undefined): ToolRow[] {
  if (!enabled) return rows.filter((r) => r.readOnly);
  const set = new Set(enabled);
  return rows.filter((r) => set.has(r.slug));
}

/** Per-run ceiling for all Composio schemas together. */
export const SCHEMA_TOKEN_BUDGET = 14_000;

/** Greedy, order-preserving: read-only tools first so a tight budget never drops the safe ones. */
export function applyBudget<T extends { schemaTokens: number; readOnly: boolean }>(items: T[], budget = SCHEMA_TOKEN_BUDGET): { kept: T[]; dropped: number } {
  const ordered = [...items].sort((a, b) => Number(b.readOnly) - Number(a.readOnly));
  const kept: T[] = [];
  let used = 0;
  for (const it of ordered) {
    if (used + it.schemaTokens > budget) continue;
    used += it.schemaTokens;
    kept.push(it);
  }
  return { kept, dropped: items.length - kept.length };
}
