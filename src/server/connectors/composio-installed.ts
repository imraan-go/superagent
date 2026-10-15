import "server-only";
import { ComposioClient } from "./composio-client";
import { findToolkit } from "./composio-catalog";
import { getComposioConfig } from "./composio-config";
import { selectedActions } from "./composio-schema";
import { getCatalog, getToolkitTools } from "./composio-tools";
import { groupAccounts } from "./composio-installed-pure";
import type { InstalledApp } from "./composio-installed-pure";

/** Connected apps joined with their catalog entry and the owner's enabled-tool counts. */
export async function installedApps(client: ComposioClient): Promise<InstalledApp[]> {
  const [accounts, catalog, cfg] = await Promise.all([client.listConnectedAccounts(), getCatalog(client), getComposioConfig()]);
  const groups = groupAccounts(accounts.map((a) => ({ id: a.id, toolkit: a.toolkit?.slug ?? "", status: a.status ?? "UNKNOWN", createdAt: a.created_at ?? null })));
  return Promise.all(
    groups.map(async (g) => {
      const tk = findToolkit(catalog.toolkits, g.toolkit);
      let enabledCount: number | null = null;
      let toolsCount = tk?.toolsCount ?? 0;
      if (g.status === "ACTIVE") {
        try {
          const { rows } = await getToolkitTools(client, tk?.slug ?? g.toolkit);
          toolsCount = rows.length;
          enabledCount = selectedActions(rows, cfg.tools[tk?.slug ?? g.toolkit]).length;
        } catch {
          // Tool listing is best-effort here; the row still renders.
        }
      }
      return { ...g, name: tk?.name ?? g.toolkit, description: tk?.description ?? "", toolsCount, enabledCount };
    }),
  );
}
