import "server-only";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { settings } from "@/server/db/schema";
import { AppError } from "@/server/lib/errors";
import { lhos } from "@/server/lhos/client";
import {
  SETTINGS_SECTIONS,
  mergeSection,
  parseStored,
  reconcilePace,
  pacePristine,
  validateSection,
} from "@/lib/settings";
import type { AgentSettings, AllSettings, SectionValue, SettingsSection } from "@/lib/settings";

/**
 * Settings store: one `settings` row per section (key = section name, value =
 * jsonb). Reads always return a complete, defaulted object; writes merge a
 * partial patch, validate against the zod mirror of
 * config/settings.schema.json, and enforce the "approvals only get stricter"
 * rule server-side.
 *
 * A tiny in-process cache keeps the agent loop and session check from hitting
 * Postgres on every call. Single instance by design (ADR-04), so invalidating
 * on write is sufficient.
 */
const TTL_MS = 5_000;

const globalForSettings = globalThis as unknown as {
  __fdSettingsCache?: Map<string, { value: unknown; at: number }>;
};
const cache = (globalForSettings.__fdSettingsCache ??= new Map());

async function readRaw(key: string): Promise<unknown> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);
  const value = row?.value ?? null;
  cache.set(key, { value, at: Date.now() });
  return value;
}

async function writeRaw(key: string, value: unknown): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
  cache.set(key, { value, at: Date.now() });
}

/**
 * LHOS's live pace, cached briefly. Only consulted while no pace was ever
 * saved; any failure falls back to the schema default. Read-only: never calls
 * set_pace.
 */
const PACE_TTL_MS = 60_000;
const gPace = globalThis as unknown as { __fdLhosPace?: { mode: string | null; at: number } };

async function lhosPaceMode(): Promise<string | null> {
  const hit = gPace.__fdLhosPace;
  if (hit && Date.now() - hit.at < PACE_TTL_MS) return hit.mode;
  let mode: string | null = null;
  try {
    mode = (await lhos.getCapabilities({ timeoutMs: 3_000 })).pace?.mode ?? null;
  } catch {
    mode = null;
  }
  gPace.__fdLhosPace = { mode, at: Date.now() };
  return mode;
}

async function withPace(agent: AgentSettings, raw: unknown): Promise<AgentSettings> {
  if (!pacePristine(raw)) return agent;
  return reconcilePace(agent, raw, await lhosPaceMode());
}

export async function getSection<S extends SettingsSection>(section: S): Promise<SectionValue<S>> {
  const raw = await readRaw(section);
  const value = parseStored(section, raw);
  if (section === "agent") return (await withPace(value as AgentSettings, raw)) as SectionValue<S>;
  return value;
}

export async function getAllSettings(): Promise<AllSettings> {
  const rows = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(inArray(settings.key, SETTINGS_SECTIONS));
  const byKey = new Map(rows.map((r) => [r.key, r.value]));

  const out = {} as Record<SettingsSection, unknown>;
  for (const section of SETTINGS_SECTIONS) {
    out[section] = parseStored(section, byKey.get(section));
  }
  out.agent = await withPace(out.agent as AgentSettings, byKey.get("agent"));
  return out as AllSettings;
}

/** Merge-and-validate write. Returns the saved, defaulted section. */
export async function updateSection<S extends SettingsSection>(
  section: S,
  patch: unknown,
  options?: { shallow?: boolean },
): Promise<SectionValue<S>> {
  const current = await getSection(section);
  const merged = mergeSection(current, patch, options);

  let value: SectionValue<S>;
  try {
    value = validateSection(section, merged);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const issue = err.issues[0];
      throw new AppError(
        "bad_request",
        issue ? `${[section, ...issue.path].join(".")}: ${issue.message}` : "Invalid settings.",
      );
    }
    throw err;
  }

  await writeRaw(section, value);
  return value;
}

/* ------------------------------------------------------ internal keys -- */

/**
 * "Sign out everywhere": sessions minted before this unix-seconds epoch are
 * rejected by `getOwner()`. Not a public settings section — only the Danger
 * zone route writes it.
 */
const SESSION_EPOCH_KEY = "auth.sessionEpoch";

export async function getSessionEpoch(): Promise<number> {
  const raw = await readRaw(SESSION_EPOCH_KEY);
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}

export async function bumpSessionEpoch(): Promise<number> {
  const epoch = Math.floor(Date.now() / 1000);
  await writeRaw(SESSION_EPOCH_KEY, epoch);
  return epoch;
}
