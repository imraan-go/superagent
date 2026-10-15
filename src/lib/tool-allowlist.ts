import { DEFAULT_TOOL_ALLOWLIST, OPERATOR_TOOLS } from "@/server/agent/allowlist";
import { lockedToolReason } from "@/server/agent/guard";
import { requiresApproval } from "@/server/agent/policy";
import { categoryIdOf } from "./tool-categories";

export type PresetId = "recommended" | "operator" | "everything" | "rdp" | "browser";

export const PRESETS: ReadonlyArray<{ id: PresetId; label: string; hint: string }> = [
  { id: "recommended", label: "Recommended (default)", hint: "Operator work: OCR, GUI, RDP, structured browser, files, API." },
  { id: "operator", label: "Full computer operator", hint: "Everything real operator sessions used, incl. clipboard and batches. No locked tools." },
  { id: "everything", label: "Everything allowed", hint: "Every tool that is not locked. Highest token cost." },
  { id: "rdp", label: "Windows/RDP work", hint: "Recommended plus the RDP tools." },
  { id: "browser", label: "Browser only", hint: "Browser and observe tools, plus asking you." },
];

export function isLocked(name: string): boolean {
  return lockedToolReason(name) !== null;
}

/** Selection as saved: only real, unlocked catalog tools, sorted. */
export function sanitizeSelection(names: Iterable<string>, available: readonly string[]): string[] {
  const known = new Set(available);
  return [...new Set(names)].filter((n) => known.has(n) && !isLocked(n)).sort();
}

/** Applies an enable/disable of `names`, skipping locked tools. */
export function toggleNames(selected: ReadonlySet<string>, names: readonly string[], on: boolean): Set<string> {
  const next = new Set(selected);
  for (const n of names) {
    if (isLocked(n)) continue;
    if (on) next.add(n);
    else next.delete(n);
  }
  return next;
}

/** Rough tokens per model call for tools of the given serialized sizes (chars / 4). */
export function estimateSchemaTokens(sizes: ReadonlyArray<number>): number {
  return Math.round(sizes.reduce((a, b) => a + b, 0) / 4);
}

/** First sentence, trimmed to one short line. */
export function shortDescription(text: string, max = 110): string {
  const line = (text.split("\n")[0] ?? "").trim();
  const stop = line.search(/[.!?]\s/);
  const sentence = stop >= 0 ? line.slice(0, stop + 1) : line;
  return sentence.length > max ? sentence.slice(0, max - 1).trimEnd() + "\u2026" : sentence;
}

/** Tools that stop for owner approval under the built-in rules. */
export function needsApproval(name: string): boolean {
  // http_request is gated on write methods; flag it so the owner knows.
  return requiresApproval(name).required || requiresApproval(name, {}, { method: "POST" }).required;
}

/** Names a preset selects, limited to the available tools and never including locked ones. */
export function computePreset(id: PresetId, available: readonly string[]): string[] {
  const defaults = new Set(DEFAULT_TOOL_ALLOWLIST);
  const pick = (test: (name: string) => boolean) => available.filter((n) => !isLocked(n) && test(n)).sort();
  switch (id) {
    case "recommended":
      return pick((n) => defaults.has(n));
    case "operator": {
      const operator = new Set(OPERATOR_TOOLS);
      return pick((n) => operator.has(n));
    }
    case "everything":
      return pick(() => true);
    case "rdp":
      return pick((n) => defaults.has(n) || categoryIdOf(n) === "rdp");
    case "browser":
      return pick((n) => ["browser", "observe", "hitl"].includes(categoryIdOf(n)));
  }
}

/** Which preset (if any) the current selection equals. */
export function matchingPreset(selected: ReadonlySet<string>, available: readonly string[]): PresetId | null {
  for (const p of PRESETS) {
    const want = computePreset(p.id, available);
    if (want.length === selected.size && want.every((n) => selected.has(n))) return p.id;
  }
  return null;
}
