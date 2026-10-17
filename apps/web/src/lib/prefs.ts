import { z } from "zod";

/**
 * Sound and notification preferences, mirroring the `sound` and
 * `notifications` sections of config/settings.schema.json. The Settings API
 * (built separately) serves them at `/api/settings/{section}`; anything
 * missing, malformed or unreachable falls back to the schema defaults.
 */
export const SOUND_EVENTS = ["send", "done", "approval", "error", "takeover"] as const;
export type SoundEvent = (typeof SOUND_EVENTS)[number];

const eventToggle = z.boolean().catch(true).default(true);

export const soundPrefsSchema = z.object({
  master: z.boolean().catch(true).default(true),
  volume: z.number().min(0).max(1).catch(0.3).default(0.3),
  events: z
    .object({
      send: eventToggle,
      done: eventToggle,
      approval: eventToggle,
      error: eventToggle,
      takeover: eventToggle,
    })
    .catch({ send: true, done: true, approval: true, error: true, takeover: true })
    .default({ send: true, done: true, approval: true, error: true, takeover: true }),
});
export type SoundPrefs = z.infer<typeof soundPrefsSchema>;

export const NOTIFY_EVENTS = ["approval", "runDone", "question"] as const;
export type NotifyEvent = (typeof NOTIFY_EVENTS)[number];

export const notificationPrefsSchema = z.object({
  chrome: z.boolean().catch(false).default(false),
  events: z
    .array(z.enum(NOTIFY_EVENTS))
    .catch([...NOTIFY_EVENTS])
    .default([...NOTIFY_EVENTS]),
});
export type NotificationPrefs = z.infer<typeof notificationPrefsSchema>;

export const DEFAULT_SOUND_PREFS: SoundPrefs = soundPrefsSchema.parse({});
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = notificationPrefsSchema.parse({});

/**
 * Accepts either the bare section or `{ sound: {...} }`/`{ value: {...} }`
 * envelopes, so the client does not break on a small API-shape choice.
 */
export function parseSection<T>(schema: z.ZodType<T>, section: string, raw: unknown): T {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const candidate =
    obj[section] && typeof obj[section] === "object"
      ? obj[section]
      : obj.value && typeof obj.value === "object"
        ? obj.value
        : obj;
  const parsed = schema.safeParse(candidate);
  return parsed.success ? parsed.data : schema.parse({});
}

/** Whether a sound plays at all for this event. */
export function soundEnabled(prefs: SoundPrefs, event: SoundEvent, manageMode: boolean): boolean {
  // DESIGN_SYSTEM §Sound: never in Manage mode (service failure aside, which
  // is not one of these cues).
  if (manageMode) return false;
  return prefs.master && prefs.volume > 0 && prefs.events[event];
}
