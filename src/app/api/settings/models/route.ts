import { AppError } from "@/server/lib/errors";
import { json, ownerRoute } from "@/server/lib/route";
import {
  listEffectiveModels,
  listModels,
  resolveDefaultModelFromSettings,
  vendorKeyStatus,
} from "@/server/models";
import { catalog } from "@/server/models/catalog";
import { getSection, updateSection } from "@/server/settings/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Settings → Models view: vendor key status (last4 only), every catalogue
 * model with its effective enabled/price and the catalogue defaults beside
 * them, plus the default + fallback choice. Never contains key material.
 */
async function view() {
  const [vendors, effective, settings, agent, resolved] = await Promise.all([
    vendorKeyStatus(),
    listEffectiveModels(),
    getSection("models"),
    getSection("agent"),
    resolveDefaultModelFromSettings(),
  ]);
  const base = new Map(listModels({ includeDisabled: true }).map((m) => [m.id, m]));
  const ready = new Map(vendors.map((v) => [v.vendor, v.ready]));

  return {
    vendors,
    models: effective.map((m) => ({
      id: m.id,
      label: m.label,
      vendor: m.vendor,
      tier: m.tier ?? null,
      note: m.note ?? null,
      enabled: m.enabled,
      price: m.price,
      catalogPrice: base.get(m.id)?.price ?? m.price,
      catalogEnabled: base.get(m.id)?.enabled ?? m.enabled,
      overridden: Boolean(settings.overrides[m.id]),
      ready: ready.get(m.vendor) === true,
    })),
    defaultModel: agent.defaultModel ?? null,
    fallbackModel: settings.fallbackModel ?? null,
    catalogDefault: catalog.defaultModel,
    catalogFallback: catalog.fallbackModel ?? null,
    /** What a new chat would actually use right now. */
    effectiveDefault: resolved.id,
  };
}

export const GET = ownerRoute(async () => json(await view()));

/**
 * Body: `{ defaultModel?, fallbackModel?, overrides? }`. `overrides` merges per
 * model id; `{ "<id>": null }` resets that model to the catalogue.
 */
export const PUT = ownerRoute(async ({ request }) => {
  const body: unknown = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AppError("bad_request", "Body must be a JSON object.");
  }
  const { defaultModel, fallbackModel, overrides } = body as Record<string, unknown>;
  const known = new Set(listModels({ includeDisabled: true }).map((m) => m.id));

  for (const id of [defaultModel, fallbackModel]) {
    if (id !== undefined && id !== null && (typeof id !== "string" || !known.has(id))) {
      throw new AppError("bad_request", `Unknown model "${String(id)}".`);
    }
  }

  if (defaultModel !== undefined) await updateSection("agent", { defaultModel });

  const patch: Record<string, unknown> = {};
  if (fallbackModel !== undefined) patch.fallbackModel = fallbackModel;
  if (overrides !== undefined) {
    if (typeof overrides !== "object" || overrides === null || Array.isArray(overrides)) {
      throw new AppError("bad_request", "overrides must be an object.");
    }
    const current = { ...(await getSection("models")).overrides } as Record<string, unknown>;
    for (const [id, value] of Object.entries(overrides)) {
      if (!known.has(id)) throw new AppError("bad_request", `Unknown model "${id}".`);
      if (value !== null && (typeof value !== "object" || Array.isArray(value))) {
        throw new AppError("bad_request", `overrides.${id} must be an object or null.`);
      }
      if (value === null) delete current[id];
      else current[id] = { ...(current[id] as object | undefined), ...(value as object) };
    }
    patch.overrides = current;
  }
  // Shallow: `overrides` is replaced whole so reset ids actually disappear.
  if (Object.keys(patch).length > 0) await updateSection("models", patch, { shallow: true });

  return json(await view());
});
