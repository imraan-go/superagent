import { categoryIdOf } from "./tool-categories";

/**
 * Composer capability chips (Computer · Browser · RDP · Connectors · MCP · Memory).
 *
 * A chip selection can only NARROW what the owner's allowlist already offers —
 * it never enables a tool the allowlist (or the safety guard) left out. No chips
 * selected = no narrowing. Observing the screen and asking the owner are always
 * kept so the agent can still look and ask before acting.
 */
export const CAPABILITIES = ["computer", "browser", "rdp", "connectors", "mcp", "memory"] as const;
export type Capability = (typeof CAPABILITIES)[number];

const ALWAYS = new Set(["observe", "hitl"]);

const BY_CATEGORY: Record<string, Capability[]> = {
  gui: ["computer"],
  shell: ["computer"],
  ops: ["computer"],
  browser: ["browser"],
  rdp: ["rdp"],
  api: ["connectors"],
  workflows: ["computer"],
};

/** Which capability a tool name belongs to; null = always allowed. */
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
    const cap = capabilityOf(t.name);
    return cap === "always" || cap === null || chosen.has(cap);
  });
}
