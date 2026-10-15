/**
 * Namespacing for non-LHOS tools exposed to the agent loop. Pure module.
 *
 *   composio__<app>__<action>   Composio connected-app actions
 *   mcp__<server>__<tool>       remote MCP servers
 *   pipedream__emit             outbound Pipedream event
 *
 * Vendor tool-name rules are the tightest common denominator:
 * `^[a-zA-Z0-9_-]{1,64}$`. Names are slugged and clipped to fit; the original
 * identifiers are kept in the registry so clipping never loses routing.
 */
export const TOOL_NAME_MAX = 64;
export type ToolNamespace = "composio" | "mcp" | "pipedream";

export function slug(part: string): string {
  return part
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "") || "x";
}

export function namespacedTool(ns: ToolNamespace, group: string, action?: string): string {
  const name = action === undefined ? `${ns}__${slug(group)}` : `${ns}__${slug(group)}__${slug(action)}`;
  return name.slice(0, TOOL_NAME_MAX);
}

export function parseNamespaced(
  name: string,
): { ns: ToolNamespace; group: string; action: string | null } | null {
  const m = /^(composio|mcp|pipedream)__([a-z0-9_]+?)(?:__([a-z0-9_]+))?$/.exec(name);
  if (!m) return null;
  return { ns: m[1] as ToolNamespace, group: m[2]!, action: m[3] ?? null };
}

export function isExternalToolName(name: string): boolean {
  return parseNamespaced(name) !== null;
}
