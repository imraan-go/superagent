import { z } from "zod";

/**
 * Runtime settings — the zod mirror of `config/settings.schema.json`.
 *
 * Shared by server (validation before every write, defaults on every read) and
 * browser (form types + optimistic defaults). Every field has a default, so a
 * section that has never been saved still parses to a complete object; an
 * empty `{}` row and a missing row mean the same thing.
 *
 * Keep this file and the JSON schema in lockstep — `settings.test.ts` checks
 * that the defaults declared there match the ones here.
 */

/** Approval verbs that can never be removed from Settings → Approvals. */
export const DEFAULT_CHECKPOINT_PATTERNS = [
  "send",
  "post",
  "publish",
  "pay",
  "delete",
  "trash",
  "submit",
] as const;

export const NOTIFICATION_EVENTS = ["approval", "runDone", "takeover", "serviceDown"] as const;
export const SOUND_EVENTS = ["send", "done", "approval", "error", "takeover"] as const;

const agentSchema = z.object({
  systemPrompt: z.string().max(20_000).default(""),
  defaultModel: z.string().max(200).optional(),
  maxSteps: z.number().int().min(1).max(200).default(40),
  maxCostUsdPerRun: z.number().min(0).max(1_000).default(2),
  pace: z.enum(["fast", "careful"]).default("careful"),
  /** Absent → the built-in ADR-06 default list. */
  toolAllowlist: z.array(z.string().regex(/^[A-Za-z0-9_]+$/).max(120)).max(500).optional(),
  memoryRecallTopK: z.number().int().min(0).max(32).default(8),
});

const approvalsSchema = z.object({
  checkpointPatterns: z
    .array(z.string().trim().min(1).max(200))
    .max(100)
    .default([...DEFAULT_CHECKPOINT_PATTERNS]),
  notifyChrome: z.boolean().default(true),
  autoExpandComputerOnTakeover: z.boolean().default(true),
});

const appearanceSchema = z.object({
  theme: z.enum(["dark", "light", "system"]).default("dark"),
  reducedMotion: z.enum(["system", "on", "off"]).default("system"),
  density: z.enum(["comfortable", "compact"]).default("comfortable"),
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

const connectorsSchema = z.object({
  composioEnabled: z.boolean().default(false),
  pipedreamEnabled: z.boolean().default(false),
});

const usageSchema = z.object({
  dailyBudgetUsd: z.number().min(0).max(100_000).default(10),
  warnAtPct: z.number().int().min(1).max(100).default(80),
  /** Danger zone "archive counters": the Usage view starts here. Mark only. */
  archivedAt: z.iso.datetime().optional(),
});

const manageSchema = z.object({
  statsPollSeconds: z.number().int().min(2).max(60).default(5),
  confirmHoldMs: z.number().int().min(300).max(2000).default(600),
});

const dataSchema = z.object({
  /** 0 = keep forever. Pruning itself is a Phase 6 job; this is the policy. */
  retentionDays: z.number().int().min(0).max(3650).default(0),
});

const priceOverrideSchema = z.object({
  in: z.number().min(0).max(10_000),
  out: z.number().min(0).max(10_000),
  cachedIn: z.number().min(0).max(10_000).optional(),
});

const modelsSchema = z.object({
  fallbackModel: z.string().max(200).optional(),
  /** Per catalogue id: enable/disable and price override (USD / Mtok). */
  overrides: z
    .record(
      z.string().max(200),
      z.object({
        enabled: z.boolean().optional(),
        price: priceOverrideSchema.optional(),
      }),
    )
    .default({}),
});

export const sectionSchemas = {
  agent: agentSchema,
  approvals: approvalsSchema,
  appearance: appearanceSchema,
  sound: soundSchema,
  notifications: notificationsSchema,
  connectors: connectorsSchema,
  usage: usageSchema,
  manage: manageSchema,
  data: dataSchema,
  models: modelsSchema,
} as const;

export type SettingsSection = keyof typeof sectionSchemas;
export const SETTINGS_SECTIONS = Object.keys(sectionSchemas) as SettingsSection[];

export type SectionValue<S extends SettingsSection> = z.output<(typeof sectionSchemas)[S]>;
export type AllSettings = { [S in SettingsSection]: SectionValue<S> };

export type AgentSettings = SectionValue<"agent">;
export type ApprovalsSettings = SectionValue<"approvals">;
export type AppearanceSettings = SectionValue<"appearance">;
export type SoundSettings = SectionValue<"sound">;
export type NotificationsSettings = SectionValue<"notifications">;
export type UsageSettings = SectionValue<"usage">;
export type DataSettings = SectionValue<"data">;
export type ModelsSettings = SectionValue<"models">;
export type PriceOverride = z.infer<typeof priceOverrideSchema>;

export function isSection(value: string): value is SettingsSection {
  return Object.hasOwn(sectionSchemas, value);
}

export function sectionDefaults<S extends SettingsSection>(section: S): SectionValue<S> {
  return sectionSchemas[section].parse({}) as SectionValue<S>;
}

/**
 * Reads a stored value leniently: a row written by an older schema (or edited
 * by hand) must never take the panel down, so an invalid row degrades to the
 * defaults for the fields that fail, and to full defaults if nothing parses.
 */
export function parseStored<S extends SettingsSection>(
  section: S,
  stored: unknown,
): SectionValue<S> {
  const schema = sectionSchemas[section];
  const direct = schema.safeParse(stored ?? {});
  if (direct.success) return direct.data as SectionValue<S>;

  // Keep only the top-level keys that are individually valid.
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
 * PUT semantics: a partial patch merged over the current value. Plain objects
 * merge one level deep (so `{events:{send:false}}` keeps the other sound
 * events); arrays and scalars replace; `null` clears an optional field.
 */
export function mergeSection(
  current: unknown,
  patch: unknown,
  options?: { shallow?: boolean },
): Record<string, unknown> {
  const base = isPlainObject(current) ? { ...current } : {};
  if (!isPlainObject(patch)) return base;

  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete base[key];
    } else if (!options?.shallow && isPlainObject(value) && isPlainObject(base[key])) {
      base[key] = { ...(base[key] as Record<string, unknown>), ...value };
    } else {
      base[key] = value;
    }
  }
  return base;
}

/**
 * Approvals can only get stricter: the defaults are always present, deduped
 * case-insensitively, in a stable order (defaults first).
 */
export function enforceCheckpointDefaults(patterns: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of [...DEFAULT_CHECKPOINT_PATTERNS, ...patterns]) {
    const key = p.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(p.trim());
  }
  return out;
}

/** Validates a merged section for writing. Throws a ZodError on bad input. */
export function validateSection<S extends SettingsSection>(
  section: S,
  merged: unknown,
): SectionValue<S> {
  const value = sectionSchemas[section].parse(merged) as SectionValue<S>;
  if (section === "approvals") {
    const approvals = value as ApprovalsSettings;
    return {
      ...approvals,
      checkpointPatterns: enforceCheckpointDefaults(approvals.checkpointPatterns),
    } as SectionValue<S>;
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** ADR-08: Settings' pace → concrete LHOS `set_pace` arguments. */
export function paceArgs(pace: "fast" | "careful"): {
  mode: string;
  min_gap_seconds: number;
  max_actions_per_hour: number;
} {
  return pace === "fast"
    ? { mode: "fast", min_gap_seconds: 4, max_actions_per_hour: 60 }
    : { mode: "careful", min_gap_seconds: 12, max_actions_per_hour: 20 };
}
