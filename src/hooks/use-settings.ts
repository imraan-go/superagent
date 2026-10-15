"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";
import { sectionDefaults } from "@/lib/settings";
import type { SectionValue, SettingsSection } from "@/lib/settings";

/**
 * Settings client. One react-query entry per section (`["settings", s]`), so
 * tabs, the sound hook and AppearanceSync share a cache. Saves are optimistic
 * and roll back on a server rejection.
 */
export async function settingsFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : undefined,
    cache: "no-store",
  });
  const text = await response.text();
  const body: unknown = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(
      err?.code ?? "internal",
      err?.message ?? `Request failed (${response.status}).`,
      response.status,
    );
  }
  return body as T;
}

export function useSettingsSection<S extends SettingsSection>(section: S, enabled = true) {
  const qc = useQueryClient();
  const key = ["settings", section] as const;

  const query = useQuery({
    queryKey: key,
    queryFn: () => settingsFetch<SectionValue<S>>(`/api/settings/${section}`),
    enabled,
  });

  const mutation = useMutation({
    mutationFn: (patch: Partial<Record<keyof SectionValue<S>, unknown>>) =>
      settingsFetch<SectionValue<S>>(`/api/settings/${section}`, {
        method: "PUT",
        body: JSON.stringify(patch),
      }),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<SectionValue<S>>(key);
      if (previous) {
        const optimistic = { ...previous } as Record<string, unknown>;
        for (const [k, v] of Object.entries(patch)) {
          if (v === null) delete optimistic[k];
          else optimistic[k] = v;
        }
        qc.setQueryData(key, optimistic as SectionValue<S>);
      }
      return { previous };
    },
    onError: (_err, _patch, context) => {
      if (context?.previous) qc.setQueryData(key, context.previous);
    },
    onSuccess: (saved) => qc.setQueryData(key, saved),
  });

  return {
    /** Server value, or the schema defaults while loading. */
    value: query.data ?? sectionDefaults(section),
    loaded: query.isSuccess,
    error: query.error ?? mutation.error,
    saving: mutation.isPending,
    /** Never rejects — a failure lands in `error` and the value rolls back. */
    save: (patch: Partial<Record<keyof SectionValue<S>, unknown>>) =>
      mutation.mutateAsync(patch).catch(() => undefined),
    refetch: query.refetch,
  };
}
