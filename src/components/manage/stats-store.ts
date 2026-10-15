import { pushSample } from "@/lib/manage/sparkline";
import type { Sample } from "@/lib/manage/sparkline";
import { percentOf } from "@/lib/manage/thresholds";
import type { Stats } from "./api";

/**
 * Module-level sparkline history (client only, in memory). Living outside the
 * component means switching Manage sections does not reset the 30-minute view.
 */
export interface StatsHistory {
  cpu: Sample[];
  ram: Sample[];
  swap: Sample[];
  disk: Sample[];
}

const EMPTY: StatsHistory = { cpu: [], ram: [], swap: [], disk: [] };
let history: StatsHistory = EMPTY;
const listeners = new Set<() => void>();

export function recordStats(s: Stats): void {
  const t = Math.round(s.ts * 1000);
  history = {
    cpu: s.cpuPercent === null ? history.cpu : pushSample(history.cpu, { t, v: s.cpuPercent }),
    ram: pushSample(history.ram, { t, v: percentOf(s.memTotal - s.memAvailable, s.memTotal) }),
    swap: pushSample(history.swap, { t, v: percentOf(s.swapTotal - s.swapFree, s.swapTotal) }),
    disk: pushSample(history.disk, { t, v: s.diskUsedPercent }),
  };
  for (const l of listeners) l();
}

export function subscribeStats(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export const getStatsHistory = (): StatsHistory => history;
export const getServerStatsHistory = (): StatsHistory => EMPTY;
