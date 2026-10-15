import { listModelOptions, resolveDefaultModelFromSettings } from "@/server/models";
import { json, ownerRoute } from "@/server/lib/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Prompt-bar model picker: enabled models after Settings overrides, each with
 * `ready` = its vendor has a key (stored in Settings or env). Prices stay
 * server-side; the UI only needs labels.
 */
export const GET = ownerRoute(async () => {
  const [models, fallback] = await Promise.all([
    listModelOptions(),
    resolveDefaultModelFromSettings(),
  ]);
  const ready = models.filter((m) => m.ready);

  return json({
    models,
    defaultModel: fallback.id,
    /** Mock-only means no vendor key is set anywhere yet. */
    anyVendorReady: ready.some((m) => m.vendor !== "mock"),
  });
});
