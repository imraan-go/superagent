/** Client-side shapes of the /api/connectors/composio/* responses. Keep in step with the server modules. */
import type { CatalogSections, CatalogToolkit, Facet, ToolkitDetail } from "@/server/connectors/composio-catalog";
import type { InstalledApp } from "@/server/connectors/composio-installed-pure";

export type { CatalogSections, CatalogToolkit, Facet, ToolkitDetail, InstalledApp };

export interface ComposioAccount {
  id: string;
  toolkit: string;
  status: string;
  reason: string | null;
  scheme: string | null;
  createdAt?: string | null;
}

export type ComposioStatus =
  | { configured: false }
  | { configured: true; source: "settings" | "env"; last4: string | null; accounts: ComposioAccount[]; mcp: { serverId: string } | null; triggers: number; error: string | null };

export interface CatalogPage {
  items: CatalogToolkit[];
  total: number;
  offset: number;
  facets: Facet[];
  categories: string[];
  catalogSize: number;
  upstreamTotal: number | null;
}

export type CatalogSectionsResponse = CatalogSections & {
  facets: Facet[];
  categories: string[];
  catalogSize: number;
  upstreamTotal: number | null;
};

export type ConnectResult =
  | { kind: "redirect"; redirectUrl: string; accountId?: string }
  | { kind: "connected" }
  | { kind: "needs_credentials"; scheme: string; fields: CredentialField[] }
  | { kind: "unsupported"; reason: string; guideUrl: string | null };

export interface CredentialField {
  name: string;
  displayName: string;
  required: boolean;
  secret: boolean;
}

export const COMPOSIO_STATUS_KEY = ["connectors", "composio"] as const;
