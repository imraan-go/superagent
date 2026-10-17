"use client";

import { useLayoutEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Gauge, Robot } from "@phosphor-icons/react/dist/ssr";
import { SegmentedSwitch } from "@/components/ui";

type Mode = "agent" | "manage";

/**
 * Agent ⇄ Manage. The switch is the route: Manage is `/manage`, Agent is the
 * chat workspace. `data-mode` on <html> swaps the signal token to amber.
 */
export function ModeSwitch() {
  const pathname = usePathname();
  const router = useRouter();
  const mode: Mode = pathname.startsWith("/manage") ? "manage" : "agent";

  useLayoutEffect(() => {
    document.documentElement.dataset.mode = mode;
  }, [mode]);

  return (
    <SegmentedSwitch<Mode>
      label="Workspace mode"
      value={mode}
      onChange={(next) => {
        document.documentElement.dataset.mode = next;
        router.push(next === "manage" ? "/manage" : "/");
      }}
      options={[
        { value: "agent", label: "Agent", icon: <Robot size={14} weight="duotone" /> },
        { value: "manage", label: "Workspaces", icon: <Gauge size={14} weight="duotone" /> },
      ]}
    />
  );
}
