import { categoryIdOf } from "./tool-categories";

/**
 * Composer capability chips (Computer · Browser · RDP · Connectors · MCP · Memory).
 *
 * A chip selection — manual, or picked per message by Auto
 * (src/lib/auto-capabilities.ts) — can only NARROW what the owner's allowlist
 * already offers; it never enables a tool the allowlist (or the safety guard)
 * left out. No chips = no narrowing. The GUI family serves both Computer and
 * RDP (Windows is driven through click_text / desktop_* / wait). Observing the
 * screen and asking the owner are always kept.
 */
export const CAPABILITIES = ["computer", "browser", "rdp", "connectors", "mcp", "memory"] as const;
export type Capability = (typeof CAPABILITIES)[number];

const ALWAYS = new Set(["observe", "hitl"]);

const BY_CATEGORY: Record<string, Capability[]> = {
  // RDP is driven through the GUI family (click_text, desktop_click/scroll/key, wait).
  gui: ["computer", "rdp"],
  shell: ["computer"],
  ops: ["computer"],
  browser: ["browser"],
  rdp: ["rdp"],
  api: ["connectors"],
  workflows: ["computer"],
};

/** Capabilities a tool serves; "always" = kept whatever the chips; [] = unclassified (kept). */
export function capabilitiesOf(toolName: string): Capability[] | "always" {
  const lower = toolName.toLowerCase();
  if (lower.startsWith("mcp__")) return ["mcp"];
  if (lower.startsWith("composio__") || lower.startsWith("pipedream__")) return ["connectors"];
  if (lower.includes("memory") || lower.includes("memories")) return ["memory"];
  const cat = categoryIdOf(toolName);
  if (ALWAYS.has(cat)) return "always";
  return BY_CATEGORY[cat] ?? [];
}

/** Primary capability of a tool name; null = always allowed. */
export function capabilityOf(toolName: string): Capability | "always" | null {
  const lower = toolName.toLowerCase();
  if (lower.startsWith("mcp__")) return "mcp";
  if (lower.startsWith("composio__") || lower.startsWith("pipedream__")) return "connectors";
  if (lower.includes("memory") || lower.includes("memories")) return "memory";
  const cat = categoryIdOf(toolName);
  if (ALWAYS.has(cat)) return "always";
  return BY_CATEGORY[cat]?.[0] ?? null;
}

export function narrowByCapabilities<T extends { name: string }>(
  tools: readonly T[],
  capabilities: readonly string[] | undefined,
): T[] {
  const chosen = new Set((capabilities ?? []).filter((c): c is Capability =>
    (CAPABILITIES as readonly string[]).includes(c)));
  if (chosen.size === 0) return [...tools];
  return tools.filter((t) => {
    const caps = capabilitiesOf(t.name);
    return caps === "always" || caps.length === 0 || caps.some((c) => chosen.has(c));
  });
}
