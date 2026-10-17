"use client";

import { Brain, Globe, MagicWand, Monitor, Plugs } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/cn";
import { CAPABILITIES } from "./composer";
import type { CapabilityId } from "./composer";
import styles from "./modes.module.css";

/** Chips share the tool-category hues (DESIGN_SYSTEM §Colour). */
const CAP_CATEGORY: Record<CapabilityId, string> = {
  computer: "screen",
  browser: "browser",
  connectors: "connector",
  memory: "memory",
};

const ICONS: Record<CapabilityId, typeof Monitor> = {
  computer: Monitor,
  browser: Globe,
  connectors: Plugs,
  memory: Brain,
};

/**
 * Composer capability chips with a leading Auto chip. In Auto the server
 * picks chips per message and the picked ones light up (dashed); clicking a
 * specific chip switches to Manual; clicking Auto returns to automatic.
 * Either way chips only narrow the owner's allowlist.
 */
export function CapabilityChips({
  auto,
  caps,
  picked,
  pickedWhy,
  onAuto,
  onToggle,
}: {
  auto: boolean;
  caps: CapabilityId[];
  /** What Auto chose for the current/last message. */
  picked: string[];
  pickedWhy?: string[];
  onAuto: () => void;
  onToggle: (id: CapabilityId) => void;
}) {
  const why = pickedWhy?.join("\n");
  return (
    <div className={styles.caps} role="group" aria-label="Focus this message on">
      <button
        type="button"
        className={cn(styles.cap, styles.capAuto, auto && styles.capOn)}
        aria-pressed={auto}
        title={auto ? `Auto picks tools per message${why ? `\nLast pick:\n${why}` : ""}` : "Let the agent pick per message"}
        onClick={onAuto}
      >
        <MagicWand size={13} weight={auto ? "fill" : "regular"} aria-hidden />
        <span>Auto</span>
      </button>
      {CAPABILITIES.map((c) => {
        const Icon = ICONS[c.id];
        const on = !auto && caps.includes(c.id);
        const lit = auto && picked.includes(c.id);
        return (
          <button
            key={c.id}
            type="button"
            className={cn(styles.cap, on && styles.capOn, lit && styles.capPicked)}
            data-cat={CAP_CATEGORY[c.id]}
            aria-pressed={on}
            title={lit ? `${c.hint} — picked by Auto` : c.hint}
            onClick={() => onToggle(c.id)}
          >
            <Icon size={13} weight={on || lit ? "fill" : "regular"} aria-hidden />
            <span>{c.label}</span>
          </button>
        );
      })}
    </div>
  );
}
