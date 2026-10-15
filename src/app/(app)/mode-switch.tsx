"use client";

import { useState } from "react";
import { Gauge, Robot } from "@phosphor-icons/react/dist/ssr";
import { SegmentedSwitch } from "@/components/ui";

type Mode = "agent" | "manage";

/**
 * Agent ⇄ Manage. Phase 0 only recolors the accent (`data-mode` on <html>
 * swaps the signal token to amber); Phase 5 routes it to the Manage workspace.
 */
export function ModeSwitch() {
  const [mode, setMode] = useState<Mode>("agent");

  return (
    <SegmentedSwitch<Mode>
      label="Workspace mode"
      value={mode}
      onChange={(next) => {
        setMode(next);
        document.documentElement.dataset.mode = next;
      }}
      options={[
        { value: "agent", label: "Agent", icon: <Robot size={14} weight="duotone" /> },
        { value: "manage", label: "Manage", icon: <Gauge size={14} weight="duotone" /> },
      ]}
    />
  );
}
