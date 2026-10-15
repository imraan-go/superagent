import type { ModelsSettings } from "@/lib/settings";
import type { ModelPrice } from "./pricing";

/**
 * Owner overrides (Settings → Models) applied over the `config/models.json`
 * catalogue. Pure, so pricing overrides are unit-testable without a database.
 */
export interface OverridableModel {
  id: string;
  enabled: boolean;
  price: ModelPrice;
}

export function applyModelOverride<T extends OverridableModel>(
  model: T,
  overrides: ModelsSettings["overrides"],
): T {
  const o = overrides[model.id];
  if (!o) return model;
  return {
    ...model,
    enabled: o.enabled ?? model.enabled,
    price: o.price ? { ...o.price } : model.price,
  };
}

export function applyModelOverrides<T extends OverridableModel>(
  models: readonly T[],
  overrides: ModelsSettings["overrides"],
): T[] {
  return models.map((m) => applyModelOverride(m, overrides));
}

/**
 * First candidate that is enabled and has a key. `candidates` is in preference
 * order (owner default, owner fallback, catalogue default, catalogue fallback).
 */
export function pickDefaultModel<T extends { id: string; enabled: boolean }>(
  candidates: ReadonlyArray<string | undefined>,
  models: readonly T[],
  isReady: (model: T) => boolean,
): T | undefined {
  for (const id of candidates) {
    if (!id) continue;
    const model = models.find((m) => m.id === id);
    if (model?.enabled && isReady(model)) return model;
  }
  return models.find((m) => m.enabled && isReady(m));
}
