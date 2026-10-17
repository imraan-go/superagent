/** Shapes of the /api/connectors/composio/* responses (kept in step with apps/api). */
export interface CatalogToolkit {
  slug: string;
  name: string;
  description: string;
  logo: string | null;
  categories: string[];
  authSchemes: string[];
  /** True when Composio hosts the OAuth app, so the owner needs no developer account. */
  managedAuth: boolean;
  noAuth: boolean;
  toolsCount: number;
  triggersCount: number;
  authGuideUrl: string | null;
  pinned: boolean;
}
export interface Facet {
  name: string;
  count: number;
}
export interface CatalogSections {
  recommended: CatalogToolkit[];
  sections: Array<{ category: string; count: number; items: CatalogToolkit[] }>;
}
export interface DetailTool {
  slug: string;
  action: string;
  name: string;
  description: string;
  readOnly: boolean;
  /** Writes always stop for the owner's approval before they run. */
  needsApproval: boolean;
  enabled: boolean;
}
export interface DetailTrigger {
  slug: string;
  name: string;
  description: string;
  kind: string;
}
export interface ToolkitDetail {
  toolkit: CatalogToolkit;
  tools: DetailTool[];
  enabledCount: number;
  customized: boolean;
  triggers: DetailTrigger[];
  /** Composio's own page for the toolkit. */
  composioUrl: string;
}
