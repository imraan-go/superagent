"use client";

import { useQuery } from "@tanstack/react-query";
import { pendingPollMs } from "@/lib/hitl";
import type { PendingResponse } from "@/lib/hitl";

export const PENDING_KEY = ["approvals", "pending"] as const;

/**
 * Everything waiting on the owner. One shared query — the topbar badge, the
 * watcher and the Mission panel all read the same cache entry. Polls every
 * 5 s while a run is executing or items are open, otherwise every 60 s.
 */
export function usePending() {
  return useQuery<PendingResponse>({
    queryKey: PENDING_KEY,
    queryFn: async () => {
      const res = await fetch("/api/approvals", { cache: "no-store" });
      if (!res.ok) throw new Error(`approvals ${res.status}`);
      return (await res.json()) as PendingResponse;
    },
    refetchInterval: (query) => pendingPollMs(query.state.data),
    refetchIntervalInBackground: true,
  });
}
