"use client";

import { useEffect, useState } from "react";
import type { BudgetStatus } from "@/lib/usage-budget";

export interface UsageTotals {
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
  costUsd: number;
  calls: number;
  toolCalls: number;
}

export interface ToolStats {
  toolCalls: number;
  toolOk: number;
  toolFailed: number;
  avgToolMs: number | null;
}

export interface UsageSummary {
  day: string;
  today: UsageTotals;
  month: UsageTotals;
  chat: UsageTotals | null;
  run: UsageTotals | null;
  stats: ToolStats;
  budget: BudgetStatus | null;
}

/**
 * Subscribes to `/api/usage/live` (SSE). Every number comes from
 * `usage_events` rows (vendor-reported usage) and `run_steps`. EventSource
 * reconnects on its own; `live` reports whether the stream is open.
 */
export function useUsageTicker(chatId?: string | null, runId?: string | null) {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const qs = new URLSearchParams();
    if (chatId) qs.set("chatId", chatId);
    if (chatId && runId) qs.set("runId", runId);
    const url = qs.size ? `/api/usage/live?${qs.toString()}` : "/api/usage/live";
    const source = new EventSource(url);
    const onUsage = (e: MessageEvent<string>) => {
      try {
        setSummary(JSON.parse(e.data) as UsageSummary);
      } catch {
        // malformed frame — keep the last good summary
      }
    };
    source.addEventListener("usage", onUsage as EventListener);
    source.onopen = () => setLive(true);
    source.onerror = () => setLive(false);
    return () => {
      source.removeEventListener("usage", onUsage as EventListener);
      source.close();
    };
  }, [chatId, runId]);

  return { summary, live };
}
