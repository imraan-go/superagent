import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { secrets } from "@/server/db/schema";
import { env } from "@/server/env";
import { unseal } from "@/server/lib/crypto";
import { AppError } from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";
import { getVendor, listModels, requireModel } from "./catalog";
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
  const model = requireModel(modelId);

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

/**
 * Model picker data. Unlike `catalog.hasVendorKey` (an env-only fast path used
 * for synchronous default resolution) this also counts keys the owner stored in
 * Settings, so the picker reflects what will actually work.
 */
export async function listModelOptions(): Promise<ModelOption[]> {
  const models = listModels();
  const needed = new Set(
    models
      .map((m) => getVendor(m.vendor)?.envKey)
      .filter((k): k is string => Boolean(k)),
  );

  const stored = new Set(
    (await db.select({ name: secrets.name }).from(secrets)).map((r) => r.name),
  );

  const ready = new Map<string, boolean>();
  for (const envKey of needed) {
    ready.set(envKey, stored.has(envKey) || Boolean(process.env[envKey]?.trim()));
  }

  return models.map((m) => ({
    id: m.id,
    label: m.label,
    vendor: m.vendor,
    tier: m.tier ?? null,
    vision: m.vision,
    context: m.context,
    ready:
      m.vendor === "mock" ||
      ready.get(getVendor(m.vendor)?.envKey ?? "") === true,
  }));
}
