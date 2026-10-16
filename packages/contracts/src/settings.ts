import { z } from 'zod';

/**
 * Per-user preferences, by section. Shared by the API (validation before every write, defaults on
 * every read) and the web app (form types + optimistic defaults). Every field has a default, so a
 * section that was never saved still parses to a complete object.
 *
 * Budgets are not here: they live in user_settings and can only tighten the installation caps
 * (PUT /api/settings/budget). Tool policy is not here either: it is application-owned.
 */

export const NOTIFICATION_EVENTS = ['approval', 'runDone', 'question'] as const;
export const SOUND_EVENTS = ['send', 'done', 'approval', 'error'] as const;

const host = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/, 'must be a hostname like example.com or *.example.com');

const agentSchema = z.object({
  /** The owner's standing instructions, added to every run as preferences (never as policy). */
  systemPrompt: z.string().max(4_000).default(''),
  /** Sites every run may browse, on top of the sites named in the message itself. */
  browsingDomains: z.array(host).max(20).default([]),
});

const appearanceSchema = z.object({
  theme: z.enum(['dark', 'light', 'system']).default('dark'),
  reducedMotion: z.enum(['system', 'on', 'off']).default('system'),
  density: z.enum(['comfortable', 'compact']).default('comfortable'),
});

const soundEventsSchema = z.object({
  send: z.boolean().default(true),
  done: z.boolean().default(true),
  approval: z.boolean().default(true),
  error: z.boolean().default(true),
  takeover: z.boolean().default(true),
});

const soundSchema = z.object({
  master: z.boolean().default(true),
  volume: z.number().min(0).max(1).default(0.3),
  events: soundEventsSchema.default(soundEventsSchema.parse({})),
});

const notificationsSchema = z.object({
  chrome: z.boolean().default(false),
  events: z.array(z.enum(NOTIFICATION_EVENTS)).default([...NOTIFICATION_EVENTS]),
});

const usageSchema = z.object({
  /** Warn in the usage ticker once this share of the monthly limit is spent. */
  warnAtPct: z.number().int().min(1).max(100).default(80),
});

const manageSchema = z.object({
  statsPollSeconds: z.number().int().min(2).max(60).default(10),
  confirmHoldMs: z.number().int().min(300).max(2000).default(600),
});

export const sectionSchemas = {
  agent: agentSchema,
  appearance: appearanceSchema,
  sound: soundSchema,
  notifications: notificationsSchema,
  usage: usageSchema,
  manage: manageSchema,
} as const;

export type SettingsSection = keyof typeof sectionSchemas;
export const SETTINGS_SECTIONS = Object.keys(sectionSchemas) as SettingsSection[];

export type SectionValue<S extends SettingsSection> = z.output<(typeof sectionSchemas)[S]>;
export type AllSettings = { [S in SettingsSection]: SectionValue<S> };

export type AgentSettings = SectionValue<'agent'>;
export type AppearanceSettings = SectionValue<'appearance'>;
export type SoundSettings = SectionValue<'sound'>;
export type NotificationsSettings = SectionValue<'notifications'>;
export type UsageSettings = SectionValue<'usage'>;

export function isSection(value: string): value is SettingsSection {
  return Object.hasOwn(sectionSchemas, value);
}

export function sectionDefaults<S extends SettingsSection>(section: S): SectionValue<S> {
  return sectionSchemas[section].parse({}) as SectionValue<S>;
}

/**
 * Reads a stored value leniently: a row written by an older schema must never break the app, so
 * invalid fields fall back to their defaults and valid ones are kept.
 */
export function parseStored<S extends SettingsSection>(section: S, stored: unknown): SectionValue<S> {
  const schema = sectionSchemas[section];
  const direct = schema.safeParse(stored ?? {});
  if (direct.success) return direct.data as SectionValue<S>;
  const defaults = sectionDefaults(section) as Record<string, unknown>;
  if (!isPlainObject(stored)) return defaults as SectionValue<S>;
  const salvaged: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(stored)) {
    const candidate = schema.safeParse({ ...defaults, ...salvaged, [key]: value });
    if (candidate.success) salvaged[key] = value;
  }
  return schema.parse({ ...defaults, ...salvaged }) as SectionValue<S>;
}

/**
 * PUT semantics: a partial patch merged over the current value. Plain objects merge one level
 * deep (so `{events:{send:false}}` keeps the other sound events); arrays and scalars replace;
 * `null` clears a field back to its default.
 */
export function mergeSection(current: unknown, patch: unknown): Record<string, unknown> {
  const base = isPlainObject(current) ? { ...current } : {};
  if (!isPlainObject(patch)) return base;
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete base[key];
    else if (isPlainObject(value) && isPlainObject(base[key])) base[key] = { ...(base[key] as Record<string, unknown>), ...value };
    else base[key] = value;
  }
  return base;
}

/** Validates a merged section for writing. Throws a ZodError on bad input. */
export function validateSection<S extends SettingsSection>(section: S, merged: unknown): SectionValue<S> {
  return sectionSchemas[section].parse(merged) as SectionValue<S>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
