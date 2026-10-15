"use client";

import { useEffect, useState } from "react";
import type { BudgetStatus } from "@/lib/usage-budget";

export interface UsageTotals {
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
  costUsd: number;
  calls: number;
}

export interface UsageSummary {
  day: string;
  today: UsageTotals;
  chat: UsageTotals | null;
  budget: BudgetStatus | null;
}

/**
 * Subscribes to `/api/usage/live` (SSE). EventSource reconnects on its own;
 * `live` reports whether the stream is currently open.
 */
export function useUsageTicker(chatId?: string | null) {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const url = chatId ? `/api/usage/live?chatId=${encodeURIComponent(chatId)}` : "/api/usage/live";
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
  }, [chatId]);

  return { summary, live };
}
