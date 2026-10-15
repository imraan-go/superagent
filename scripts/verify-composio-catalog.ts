/**
 * Live check (never prints the key): the panel's catalog must contain every
 * toolkit Composio reports, and one detail aggregation must resolve.
 *   node --env-file=.env.local -r ./scripts/stub-server-only.cjs --import tsx scripts/verify-composio-catalog.ts [slug]
 */
import { ComposioClient } from "@/server/connectors/composio-client";
import { normalizeToolkit } from "@/server/connectors/composio-catalog";
import { getComposioKey } from "@/server/connectors/store";

async function main() {
  const key = await getComposioKey();
  if (!key) {
    console.log("No Composio key stored; nothing to verify live.");
    return;
  }
  const client = new ComposioClient(key.key);
  const { items, total } = await client.listAllToolkitsWithTotal();
  const slugs = new Set(items.map((t) => t.slug));
  const rows = items.map(normalizeToolkit);
  console.log(JSON.stringify({ upstreamTotal: total, fetched: items.length, unique: slugs.size, noCategory: rows.filter((r) => r.categories.length === 0).length, ok: total === slugs.size }));
  const cats = new Map<string, number>();
  for (const r of rows) for (const c of r.categories) cats.set(c, (cats.get(c) ?? 0) + 1);
  console.log("categories", cats.size, JSON.stringify([...cats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)));
  const want = ["gmail", "googledrive", "googlecalendar", "googledocs", "googlesheets", "notion", "linkedin", "whatsapp", "slack", "github", "facebook", "instagram", "metaads", "meta_ads", "twitter", "outlook", "hubspot"];
  console.log("priority present", JSON.stringify(want.filter((s) => slugs.has(s))));
  console.log("slug samples", JSON.stringify([...slugs].filter((s) => /meta|google|twitter|x$/.test(s)).slice(0, 20)));
  const slug = process.argv[2] ?? "gmail";
  const { getToolkitDetailForOwner: getToolkitDetail } = await import("@/server/connectors/composio-detail");
  const d = await getToolkitDetail(client, slug);
  console.log(JSON.stringify({ slug: d.toolkit.slug, tools: d.tools.length, triggers: d.triggers.length, readTools: d.tools.filter((t) => t.readOnly).length, authSchemes: d.toolkit.authSchemes, managed: d.toolkit.managedAuth }));
}
main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : "failed"); process.exit(1); });
