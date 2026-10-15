"use client";

import { useQuery } from "@tanstack/react-query";
import {
  DEFAULT_NOTIFICATION_PREFS,
  DEFAULT_SOUND_PREFS,
  notificationPrefsSchema,
  parseSection,
  soundPrefsSchema,
} from "@/lib/prefs";
import type { NotificationPrefs, SoundPrefs } from "@/lib/prefs";
import type { z } from "zod";

async function fetchSection<T>(section: string, schema: z.ZodType<T>): Promise<T> {
  try {
    const res = await fetch(`/api/settings/${section}`, { cache: "no-store" });
    if (!res.ok) return schema.parse({});
    return parseSection(schema, section, await res.json());
  } catch {
    return schema.parse({});
  }
}

/** Sound prefs from Settings; schema defaults until (or unless) they load. */
export function useSoundPrefs(): SoundPrefs {
  const { data } = useQuery({
    queryKey: ["settings", "sound"],
    queryFn: () => fetchSection("sound", soundPrefsSchema),
    staleTime: 60_000,
    retry: false,
  });
  return data ?? DEFAULT_SOUND_PREFS;
}

export function useNotificationPrefs(): NotificationPrefs {
  const { data } = useQuery({
    queryKey: ["settings", "notifications"],
    queryFn: () => fetchSection("notifications", notificationPrefsSchema),
    staleTime: 60_000,
    retry: false,
  });
  return data ?? DEFAULT_NOTIFICATION_PREFS;
}
