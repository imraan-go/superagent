/**
 * Pure keyboard-shortcut logic: combo parsing, event matching, the
 * "ignore while typing" rule, sequence (`g m`) tracking and fuzzy scoring.
 * Kept DOM-free (events are structural types) so it is unit-testable in node.
 */

export interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat?: boolean;
  defaultPrevented?: boolean;
  isComposing?: boolean;
}

export interface TargetLike {
  tagName?: string;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
}

export interface ParsedCombo {
  key: string;
  mod: boolean;
  alt: boolean;
  shift: boolean;
}

/** `mod+k`, `alt+x`, `shift+g`, `?`. `mod` is ⌘ on macOS and Ctrl elsewhere. */
export function parseCombo(combo: string): ParsedCombo {
  const parts = combo.toLowerCase().split("+");
  const key = parts.pop() ?? "";
  return {
    key: key === "space" ? " " : key,
    mod: parts.includes("mod"),
    alt: parts.includes("alt"),
    shift: parts.includes("shift"),
  };
}

export function matchCombo(e: KeyLike, combo: string): boolean {
  const c = parseCombo(combo);
  const hasMod = e.metaKey || e.ctrlKey;
  if (c.mod !== hasMod) return false;
  // Both ⌘ and Ctrl together is never a shortcut we define.
  if (e.metaKey && e.ctrlKey) return false;
  if (c.alt !== e.altKey) return false;
  const key = e.key.toLowerCase();
  if (key !== c.key) return false;
  // Shift is implicit for punctuation (`?`), so only letters care about it.
  if (/^[a-z]$/.test(c.key) && c.shift !== e.shiftKey) return false;
  return true;
}

/** True when the keystroke belongs to a text field and must not be hijacked. */
export function isTypingTarget(target: TargetLike | null | undefined): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName?.toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (target.getAttribute?.("type") ?? "text").toLowerCase();
    return !["button", "checkbox", "radio", "submit", "reset", "range", "file"].includes(type);
  }
  return target.getAttribute?.("role") === "textbox";
}

export interface Binding {
  /** One combo (`mod+k`) or a two-key sequence (`g m`). */
  keys: string;
  /** Fire even while a text field is focused (modifier combos only). */
  allowInInput?: boolean;
  handler: (e: KeyboardEvent) => void;
}

export const SEQUENCE_TIMEOUT_MS = 1000;

export function isSequence(keys: string): boolean {
  return keys.trim().includes(" ");
}

/** Whether a combo carries ⌘/Ctrl/Alt — the only kind safe to fire in inputs. */
export function hasModifier(keys: string): boolean {
  const c = parseCombo(keys);
  return c.mod || c.alt;
}

export interface MatchState {
  /** First key of a pending sequence and when it was pressed. */
  pending: { key: string; at: number } | null;
}

/**
 * Resolve one keystroke against the bindings. Returns the binding to run (or
 * null) and mutates `state` to track the first half of a sequence.
 */
export function resolveBinding(
  bindings: readonly Binding[],
  e: KeyLike,
  target: TargetLike | null | undefined,
  state: MatchState,
  now: number,
): Binding | null {
  if (e.defaultPrevented || e.isComposing) return null;
  const typing = isTypingTarget(target);
  const allowed = (b: Binding) => !typing || (b.allowInInput === true && hasModifier(b.keys));

  // Second half of a sequence.
  const pending = state.pending;
  state.pending = null;
  if (pending && now - pending.at <= SEQUENCE_TIMEOUT_MS && !typing) {
    for (const b of bindings) {
      if (!isSequence(b.keys)) continue;
      const [first, second] = b.keys.split(" ") as [string, string];
      if (first.toLowerCase() === pending.key && matchCombo(e, second)) return b;
    }
  }

  if (e.repeat) return null;

  for (const b of bindings) {
    if (isSequence(b.keys)) continue;
    if (matchCombo(e, b.keys) && allowed(b)) return b;
  }

  // Start of a sequence: a bare key that opens one, outside text fields.
  if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const key = e.key.toLowerCase();
    if (bindings.some((b) => isSequence(b.keys) && b.keys.split(" ")[0]!.toLowerCase() === key)) {
      state.pending = { key, at: now };
    }
  }
  return null;
}

/**
 * Subsequence fuzzy score: 0 = no match, higher is better. Rewards prefix,
 * word-start and consecutive hits; an empty needle matches everything.
 */
export function fuzzyScore(needle: string, haystack: string): number {
  const n = needle.trim().toLowerCase();
  if (!n) return 1;
  const h = haystack.toLowerCase();
  if (h.includes(n)) return 100 + (h.startsWith(n) ? 50 : 0) - h.indexOf(n) - h.length / 100;
  let score = 0;
  let hi = 0;
  let run = 0;
  for (const ch of n) {
    if (ch === " ") continue;
    const found = h.indexOf(ch, hi);
    if (found === -1) return 0;
    run = found === hi ? run + 1 : 0;
    const wordStart = found === 0 || /[\s\-_/]/.test(h[found - 1]!);
    score += 1 + run * 2 + (wordStart ? 3 : 0);
    hi = found + 1;
  }
  return score;
}

/** Platform-aware label for a combo, e.g. `mod+k` -> `⌘K` / `Ctrl+K`. */
export function formatCombo(keys: string, mac: boolean): string {
  return keys
    .split(" ")
    .map((part) => {
      const c = parseCombo(part);
      const k = c.key.length === 1 ? c.key.toUpperCase() : c.key;
      const mods = [c.mod ? (mac ? "⌘" : "Ctrl") : "", c.alt ? (mac ? "⌥" : "Alt") : "", c.shift ? "⇧" : ""]
        .filter(Boolean);
      return mac ? [...mods, k].join("") : [...mods, k].join("+");
    })
    .join(" then ");
}
