import "server-only";
import { z } from "zod";
import catalogJson from "../../../config/models.json";
import { AppError } from "@/server/lib/errors";

/**
 * `config/models.json` is owner-editable, so it is validated rather than cast.
 * A typo there would otherwise surface as a vendor 400 mid-run.
 */
const priceSchema = z.object({
  in: z.number().nonnegative(),
  out: z.number().nonnegative(),
  cachedIn: z.number().nonnegative().optional(),
});

const modelSchema = z.object({
  id: z.string(),
  vendor: z.string(),
  model: z.string(),
  label: z.string(),
  context: z.number().int().positive(),
  tools: z.boolean(),
  vision: z.boolean(),
  price: priceSchema,
  enabled: z.boolean(),
  tier: z.string().optional(),
  /** Narrow jobs this model is preferred for, e.g. `title-gen`. */
  roles: z.array(z.string()).optional(),
  note: z.string().optional(),
});

const vendorSchema = z.object({
  envKey: z.string(),
  baseUrl: z.url(),
});

const catalogSchema = z.object({
  defaultModel: z.string(),
  fallbackModel: z.string().optional(),
  vendors: z.record(z.string(), vendorSchema),
  models: z.array(modelSchema).min(1),
  pricingUnit: z.literal("usd_per_million_tokens"),
});

export type ModelEntry = z.infer<typeof modelSchema>;
export type VendorEntry = z.infer<typeof vendorSchema>;

const parsed = catalogSchema.safeParse(catalogJson);
if (!parsed.success) {
  throw new Error(
    `config/models.json is invalid:\n${parsed.error.issues
      .map((i) => `  • ${i.path.join(".")}: ${i.message}`)
      .join("\n")}`,
  );
}

export const catalog = parsed.data;

/**
 * The mock model is not in `models.json` — it is a development facility, not a
 * product offering, and must never appear as an owner-selectable "model" that
 * could be confused for a real one. It streams canned text and can be asked to
 * emit tool calls, which is what makes the agent loop testable without a
 * vendor key (IMPLEMENTATION_PLAN §8: the owner adds a key later).
 */
export const MOCK_MODEL_ID = "mock/echo";

export const mockModel: ModelEntry = {
  id: MOCK_MODEL_ID,
  vendor: "mock",
  model: "echo",
  label: "Mock (development)",
  context: 200_000,
  tools: true,
  vision: true,
  price: { in: 0, out: 0, cachedIn: 0 },
  enabled: true,
  tier: "mock",
};

export function listModels(options?: { includeDisabled?: boolean }): ModelEntry[] {
  const models = options?.includeDisabled
    ? catalog.models
    : catalog.models.filter((m) => m.enabled);
  return [...models, mockModel];
}

export function findModel(id: string): ModelEntry | undefined {
  if (id === MOCK_MODEL_ID) return mockModel;
  return catalog.models.find((m) => m.id === id);
}

export function requireModel(id: string): ModelEntry {
  const model = findModel(id);
  if (!model) throw new AppError("bad_request", `Unknown model "${id}".`);
  return model;
}

export function getVendor(name: string): VendorEntry | undefined {
  return catalog.vendors[name];
}

/**
 * Env-only key check — the synchronous fast path used to pick a default model
 * at request start. Keys stored in Settings live in the database, so the model
 * *picker* uses `listModelOptions()` instead, which counts both.
 */
export function hasVendorKey(model: ModelEntry): boolean {
  if (model.vendor === "mock") return true;
  const vendor = getVendor(model.vendor);
  if (!vendor) return false;
  return Boolean(process.env[vendor.envKey]?.trim());
}

/**
 * The model to use when the owner has not chosen one: their default if its key
 * exists, otherwise any enabled model with a key, otherwise the mock. Returning
 * the mock keeps the product usable (and the loop demonstrable) before a key is
 * ever entered, rather than failing at the prompt bar.
 */
export function resolveDefaultModel(): ModelEntry {
  const preferred = [catalog.defaultModel, catalog.fallbackModel]
    .filter((id): id is string => Boolean(id))
    .map(findModel);

  for (const model of preferred) {
    if (model?.enabled && hasVendorKey(model)) return model;
  }

  const anyUsable = catalog.models.find((m) => m.enabled && hasVendorKey(m));
  return anyUsable ?? mockModel;
}

/** Cheapest enabled model that declares a role, for title-gen and memory work. */
export function modelForRole(role: string): ModelEntry {
  const candidates = catalog.models
    .filter((m) => m.enabled && m.roles?.includes(role) && hasVendorKey(m))
    .sort((a, b) => a.price.in - b.price.in);

  return candidates[0] ?? resolveDefaultModel();
}
