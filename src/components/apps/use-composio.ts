"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/components/settings/tabs/shared";
import { appStatus, connectedSlugs } from "@/lib/apps";
import { COMPOSIO_STATUS_KEY } from "@/lib/composio-types";
import type { ComposioStatus } from "@/lib/composio-types";

const PENDING = (s: string) => appStatus(s) === "PENDING";

/**
 * Composio status + connected accounts. One cache key shared by Settings, the
 * sidebar dock, the composer and the Connect Apps modal, so a connection made
 * anywhere shows everywhere. Polls every 3 s only while an OAuth tab is open.
 */
export function useComposioStatus(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: COMPOSIO_STATUS_KEY,
    queryFn: () => api<ComposioStatus>("/api/connectors/composio"),
    enabled: opts.enabled ?? true,
    staleTime: 30_000,
    refetchInterval: (q) => {
      const d = q.state.data;
      return d?.configured && d.accounts.some((a) => PENDING(a.status)) ? 3000 : false;
    },
  });
}

export function useConnectedApps(): { slugs: string[]; count: number; configured: boolean; loading: boolean } {
  const { data, isPending } = useComposioStatus();
  const slugs = connectedSlugs(data);
  return { slugs, count: slugs.length, configured: data?.configured === true, loading: isPending };
}
