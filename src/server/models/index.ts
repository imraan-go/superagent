import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { secrets } from "@/server/db/schema";
import { env } from "@/server/env";
import { last4, seal, unseal } from "@/server/lib/crypto";
import { AppError } from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";
import { getSection } from "@/server/settings/store";
import { catalog, getVendor, listModels, mockModel, requireModel } from "./catalog";
import { applyModelOverride, applyModelOverrides, pickDefaultModel } from "./overrides";
import type { ModelEntry } from "./catalog";
import { AnthropicAdapter } from "./adapters/anthropic";
import { MockAdapter } from "./adapters/mock";
import { OpenAiCompatibleAdapter } from "./adapters/openai-compatible";
import type { ModelAdapter } from "./types";

export * from "./types";
export {
  MOCK_MODEL_ID,
  findModel,
  listModels,
  modelForRole,
  requireModel,
  resolveDefaultModel,
} from "./catalog";
export type { ModelEntry } from "./catalog";

/**
 * Key resolution order: the encrypted `secrets` row the owner entered in
 * Settings, then the environment. Settings wins so a key can be rotated from
 * the UI without a redeploy.
 *
 * The decrypted value never leaves this module's return value — it goes
 * straight into an adapter's private field, is never logged, and has no read
 * endpoint (rule 30-security).
 */
async function resolveKey(envKey: string): Promise<string | null> {
  const [row] = await db
    .select({ enc: secrets.enc })
    .from(secrets)
    .where(eq(secrets.name, envKey))
    .limit(1);

  if (row) {
    try {
      return unseal(row.enc);
    } catch {
      // A key sealed under a rotated PANEL_SECRET_KEY cannot be recovered; fall
      // through to env rather than failing the run with a crypto error.
      logger.error("models", { msg: "stored key failed to decrypt", key: envKey });
    }
  }

  return process.env[envKey]?.trim() || null;
}

/**
 * Builds the adapter for a catalogue model. The mock needs no key and always
 * works, which is what keeps the agent loop runnable before the owner adds a
 * real one (IMPLEMENTATION_PLAN §8).
 */
export async function getAdapter(modelId: string): Promise<{
  adapter: ModelAdapter;
  model: ModelEntry;
}> {
  // Owner price overrides apply to metering from the very next call.
  const { overrides } = await getSection("models");
  const model = applyModelOverride(requireModel(modelId), overrides);

  if (model.vendor === "mock") {
    return { adapter: new MockAdapter(), model };
  }

  const vendor = getVendor(model.vendor);
  if (!vendor) {
    throw new AppError("bad_request", `No vendor configured for "${model.vendor}".`);
  }

  const key = await resolveKey(vendor.envKey);
  if (!key) {
    throw new AppError(
      "no_model_key",
      `No API key for ${model.vendor}. Add one in Settings → Models, or pick the mock model.`,
    );
  }

  switch (model.vendor) {
    case "anthropic":
      return { adapter: new AnthropicAdapter(key, vendor.baseUrl), model };

    case "openai":
      return {
        adapter: new OpenAiCompatibleAdapter("openai", key, vendor.baseUrl),
        model,
      };

    case "openrouter":
      return {
        adapter: new OpenAiCompatibleAdapter("openrouter", key, vendor.baseUrl, {
          // OpenRouter attribution headers; harmless if the app is private.
          "http-referer": env.APP_URL,
          "x-title": "Flight Deck",
        }),
        model,
      };

    default:
      throw new AppError("bad_request", `No adapter for vendor "${model.vendor}".`);
  }
}

/* ------------------------------------------------ settings-aware views -- */

export interface ModelOption {
  id: string;
  label: string;
  vendor: string;
  tier: string | null;
  vision: boolean;
  context: number;
  /** False → the picker shows it greyed with "Add a key in Settings". */
  ready: boolean;
}

export interface VendorKeyStatus {
  vendor: string;
  envKey: string;
  /** Sealed key stored in Settings — only its last 4 characters, ever. */
  stored: { last4: string; updatedAt: string } | null;
  /** A key is present in the server environment (used when none is stored). */
  env: boolean;
  ready: boolean;
}

/** Per-vendor key presence: DB first, then env. Never returns key material. */
export async function vendorKeyStatus(): Promise<VendorKeyStatus[]> {
  const rows = await db
    .select({ name: secrets.name, last4: secrets.last4, updatedAt: secrets.updatedAt })
    .from(secrets);
  const byName = new Map(rows.map((r) => [r.name, r]));

  return Object.entries(catalog.vendors).map(([vendor, v]) => {
    const row = byName.get(v.envKey);
    const hasEnv = Boolean(process.env[v.envKey]?.trim());
    return {
      vendor,
      envKey: v.envKey,
      stored: row ? { last4: row.last4, updatedAt: row.updatedAt.toISOString() } : null,
      env: hasEnv,
      ready: Boolean(row) || hasEnv,
    };
  });
}

/** Catalogue + owner overrides, including disabled models (Settings → Models). */
export async function listEffectiveModels(): Promise<ModelEntry[]> {
  const { overrides } = await getSection("models");
  return applyModelOverrides(listModels({ includeDisabled: true }), overrides).filter(
    (m) => m.vendor !== "mock",
  );
}

async function readiness(): Promise<(m: ModelEntry) => boolean> {
  const status = await vendorKeyStatus();
  const ready = new Map(status.map((s) => [s.vendor, s.ready]));
  return (m) => m.vendor === "mock" || ready.get(m.vendor) === true;
}

/**
 * Model picker data: enabled models (after overrides) plus the mock, each
 * flagged with whether its vendor has a key (stored or env).
 */
export async function listModelOptions(): Promise<ModelOption[]> {
  const [models, isReady] = await Promise.all([listEffectiveModels(), readiness()]);
  return [...models.filter((m) => m.enabled), mockModel].map((m) => ({
    id: m.id,
    label: m.label,
    vendor: m.vendor,
    tier: m.tier ?? null,
    vision: m.vision,
    context: m.context,
    ready: isReady(m),
  }));
}

/**
 * Settings-aware default: Agent → default model, Models → fallback, then the
 * catalogue's own default/fallback, then any enabled model with a key, then
 * the mock (keeps the product usable before a key exists).
 */
export async function resolveDefaultModelFromSettings(): Promise<ModelEntry> {
  const [agent, modelsSettings, models, isReady] = await Promise.all([
    getSection("agent"),
    getSection("models"),
    listEffectiveModels(),
    readiness(),
  ]);
  return (
    pickDefaultModel(
      [agent.defaultModel, modelsSettings.fallbackModel, catalog.defaultModel, catalog.fallbackModel],
      models,
      isReady,
    ) ?? mockModel
  );
}

/* ------------------------------------------------------- key storage -- */

function vendorEnvKey(vendor: string): string {
  const v = getVendor(vendor);
  if (!v) throw new AppError("not_found", `Unknown vendor "${vendor}".`);
  return v.envKey;
}

/** Seals and stores a vendor key. Returns only last4. */
export async function storeVendorKey(vendor: string, key: string): Promise<{ last4: string }> {
  const name = vendorEnvKey(vendor);
  const value = key.trim();
  const tail = last4(value);
  const enc = seal(value);
  await db
    .insert(secrets)
    .values({ name, enc, last4: tail, vendor })
    .onConflictDoUpdate({
      target: secrets.name,
      set: { enc, last4: tail, vendor, updatedAt: new Date() },
    });
  return { last4: tail };
}

export async function removeVendorKey(vendor: string): Promise<boolean> {
  const name = vendorEnvKey(vendor);
  const removed = await db
    .delete(secrets)
    .where(eq(secrets.name, name))
    .returning({ name: secrets.name });
  return removed.length > 0;
}

/**
 * Owner-initiated key check. Uses each vendor's free metadata endpoint (list
 * models / key info), so a test costs nothing. The key never leaves the server
 * and is never echoed in an error.
 */
export async function testVendorKey(vendor: string): Promise<{ ok: true; detail: string }> {
  const name = vendorEnvKey(vendor);
  const base = getVendor(vendor)!.baseUrl.replace(/\/$/, "");
  const key = await resolveKey(name);
  if (!key) {
    throw new AppError("no_model_key", `No API key for ${vendor} is stored or in the environment.`);
  }

  const target: { url: string; headers: Record<string, string> } =
    vendor === "anthropic"
      ? {
          url: `${base}/v1/models?limit=1`,
          headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
        }
      : vendor === "openrouter"
        ? { url: `${base}/key`, headers: { authorization: `Bearer ${key}` } }
        : { url: `${base}/models`, headers: { authorization: `Bearer ${key}` } };

  let response: Response;
  try {
    response = await fetch(target.url, {
      headers: target.headers,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new AppError("vendor_error", `Could not reach ${vendor}.`);
  }
  if (response.status === 401 || response.status === 403) {
    throw new AppError("vendor_error", `${vendor} rejected the key (${response.status}).`);
  }
  if (!response.ok) {
    throw new AppError("vendor_error", `${vendor} answered ${response.status}.`);
  }
  return { ok: true, detail: `${vendor} accepted the key.` };
}

