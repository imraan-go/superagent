"use client";

import { useQuery } from "@tanstack/react-query";
import type { RailCapabilities } from "@/components/mission/mission-tab";

export interface Capabilities extends RailCapabilities {
  sandboxId?: string | null;
  pendingHumanRequests?: number;
}

export type ComputerState = "checking" | "waking" | "offline" | "awake" | "asleep";

/**
 * One shared LHOS capabilities query (same key everywhere, so the rail, the
 * minimised dock and the sidebar's computer card share one request).
 */
export function useCapabilities() {
  const query = useQuery<Capabilities>({
    queryKey: ["lhos", "capabilities"],
    queryFn: async () => {
      const res = await fetch("/api/lhos/capabilities", { cache: "no-store" });
      if (!res.ok) throw new Error("capabilities");
      return res.json() as Promise<Capabilities>;
    },
    refetchInterval: 20_000,
  });
  const c = query.data;
  const up = c?.reachable === true && c.desktopUp === true;
  const state: ComputerState = !c
    ? "checking"
    : !c.reachable
      ? c.waking
        ? "waking"
        : "offline"
      : up
        ? "awake"
        : "asleep";
  const dot = up ? ("live" as const) : c?.reachable ? ("warn" as const) : c ? ("error" as const) : ("idle" as const);
  return { capabilities: c, up, state, dot };
}
