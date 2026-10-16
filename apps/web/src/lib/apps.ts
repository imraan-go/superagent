import { appStatus } from "@/lib/shared/composio-installed-pure";
import type { AppStatus } from "@/lib/shared/composio-installed-pure";
import type { ComposioAccount, ComposioStatus } from "./composio-types";

export { appStatus, maskId } from "@/lib/shared/composio-installed-pure";
export type { AppStatus };

/** Category names arrive lowercase from Composio ("crm", "ai agents"). */
const ACRONYMS = new Set(["crm", "ai", "api", "seo", "sms", "hr", "erp", "it", "ui", "ux", "vpn", "mcp", "iot", "cms", "qa", "pdf", "ci/cd"]);
export function prettyCategory(name: string): string {
  return name
    .split(" ")
    .map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

export function logoSrc(slug: string): string {
  return `/api/connectors/composio/logo?slug=${encodeURIComponent(slug)}`;
}

/** Connection state of one toolkit: ACTIVE beats pending beats expired; null = never connected. */
export function statusFor(accounts: readonly ComposioAccount[], slug: string): { status: AppStatus; account: ComposioAccount } | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const mine = accounts.filter((a) => norm(a.toolkit) === norm(slug));
  if (mine.length === 0) return null;
  const rank = { ACTIVE: 0, PENDING: 1, EXPIRED: 2 } as const;
  const best = [...mine].sort((a, b) => rank[appStatus(a.status)] - rank[appStatus(b.status)])[0]!;
  return { status: appStatus(best.status), account: best };
}

/** Connected (ACTIVE) toolkit slugs, de-duplicated, in the order Composio returned them. */
export function connectedSlugs(status: ComposioStatus | undefined): string[] {
  if (!status?.configured) return [];
  return [...new Set(status.accounts.filter((a) => appStatus(a.status) === "ACTIVE").map((a) => a.toolkit))];
}

/** `composio__google_drive__list_files` -> `google_drive`; null for any other tool. */
export function composioToolkitOf(toolName: string | null | undefined): string | null {
  const m = /^composio__([a-z0-9_]+?)__[a-z0-9_]+$/.exec(toolName ?? "");
  return m ? m[1]! : null;
}

export function titleCase(slug: string): string {
  return slug.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
