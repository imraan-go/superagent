import { describe, expect, it } from "vitest";
import { ComposioClient } from "@/server/connectors/composio-client";
import {
  OTHER_CATEGORY,
  buildDetail,
  buildSections,
  facetsOf,
  findToolkit,
  normalizeToolkit,
  orderCatalog,
  queryCatalog,
} from "@/server/connectors/composio-catalog";
import { appStatus, groupAccounts, maskId } from "@/server/connectors/composio-installed-pure";
import { toolRow } from "@/server/connectors/composio-schema";

const json = (body: unknown) => () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

function tk(slug: string, name: string, desc: string, cats: string[], extra: Record<string, unknown> = {}) {
  return normalizeToolkit({
    slug,
    name,
    auth_schemes: ["OAUTH2"],
    composio_managed_auth_schemes: ["OAUTH2"],
    meta: { description: desc, tools_count: 3, triggers_count: 1, categories: cats.map((c) => ({ name: c })), ...extra },
  });
}

describe("catalog total", () => {
  it("returns every page and Composio's total_items from the first page", async () => {
    let i = 0;
    const pages = [
      { items: [{ slug: "a" }, { slug: "b" }], next_cursor: "c2", total_items: 3 },
      { items: [{ slug: "c" }], next_cursor: null, total_items: 3 },
    ];
    const client = new ComposioClient("k", async () => json(pages[i++]!)());
    const res = await client.listAllToolkitsWithTotal();
    expect(res.items.map((t) => t.slug)).toEqual(["a", "b", "c"]);
    expect(res.total).toBe(3);
  });

  it("reports null when Composio omits total_items", async () => {
    const client = new ComposioClient("k", async () => json({ items: [{ slug: "a" }] })());
    expect((await client.listAllToolkitsWithTotal()).total).toBeNull();
  });
});

describe("catalog search, paging, facets", () => {
  const all = orderCatalog([
    tk("zohomail", "Zoho Mail", "Email hosting", ["email"]),
    tk("gmail", "Gmail", "Google email", ["email", "communication"]),
    tk("slack", "Slack", "Team chat and mail-like threads", ["communication"]),
    tk("googledrive", "Google Drive", "Cloud files", ["documents"]),
    tk("lonely", "Lonely", "No categories", []),
  ]);

  it("puts uncategorised toolkits in Other so browsing reaches them", () => {
    expect(all.find((t) => t.slug === "lonely")!.categories).toEqual([OTHER_CATEGORY]);
    expect(queryCatalog(all, { category: "other" }).items.map((t) => t.slug)).toEqual(["lonely"]);
  });

  it("ranks name-prefix above description matches and matches across spaces/underscores", () => {
    expect(queryCatalog(all, { search: "mail" }).items.map((t) => t.slug)).toEqual(["gmail", "zohomail", "slack"]);
    expect(queryCatalog(all, { search: "google drive" }).items[0]!.slug).toBe("googledrive");
    expect(queryCatalog(all, { search: "google_drive" }).items[0]!.slug).toBe("googledrive");
    expect(queryCatalog(all, { search: "zzz" })).toEqual({ items: [], total: 0 });
  });

  it("pages without losing or repeating items", () => {
    const seen: string[] = [];
    for (let offset = 0; ; offset += 2) {
      const { items, total } = queryCatalog(all, { offset, limit: 2 });
      seen.push(...items.map((t) => t.slug));
      if (offset + 2 >= total) break;
    }
    expect(seen).toHaveLength(all.length);
    expect(new Set(seen).size).toBe(all.length);
  });

  it("filters by slug set for the Manage view", () => {
    expect(queryCatalog(all, { slugs: ["google_drive", "SLACK"] }).items.map((t) => t.slug).sort()).toEqual(["googledrive", "slack"]);
  });

  it("builds facets (Other last) and browse sections with full counts", () => {
    const facets = facetsOf(all);
    expect(facets.at(-1)!.name).toBe(OTHER_CATEGORY);
    expect(facets.find((f) => f.name === "email")!.count).toBe(2);
    const s = buildSections(all, 1);
    expect(s.recommended.map((t) => t.slug)).toEqual(["gmail", "googledrive", "slack"]);
    const email = s.sections.find((x) => x.category === "email")!;
    expect(email.count).toBe(2);
    expect(email.items).toHaveLength(1);
  });

  it("finds a toolkit from a model-facing normalised slug", () => {
    expect(findToolkit(all, "google_drive")?.slug).toBe("googledrive");
    expect(findToolkit(all, "nope")).toBeUndefined();
  });
});

describe("toolkit detail aggregation", () => {
  const toolkit = tk("gmail", "Gmail", "Mail", ["email"]);
  const rows = [
    toolRow("gmail", { slug: "GMAIL_FETCH_EMAILS", name: "Fetch emails", description: "Read" }),
    toolRow("gmail", { slug: "GMAIL_SEND_EMAIL", name: "Send email", description: "Send" }),
  ];

  it("flags writes as needing approval and joins the enabled set", () => {
    const d = buildDetail(toolkit, rows, [{ slug: "GMAIL_NEW_GMAIL_MESSAGE", name: "New message", type: "poll" }], new Set(["GMAIL_FETCH_EMAILS"]), false);
    expect(d.tools.map((t) => [t.slug, t.readOnly, t.needsApproval, t.enabled])).toEqual([
      ["GMAIL_FETCH_EMAILS", true, false, true],
      ["GMAIL_SEND_EMAIL", false, true, false],
    ]);
    expect(d.enabledCount).toBe(1);
    expect(d.customized).toBe(false);
    expect(d.triggers).toEqual([{ slug: "GMAIL_NEW_GMAIL_MESSAGE", name: "New message", description: "", kind: "poll" }]);
    expect(d.composioUrl).toBe("https://composio.dev/toolkits/gmail");
  });
});

describe("installed grouping", () => {
  it("collapses several accounts per toolkit to the best status", () => {
    const g = groupAccounts([
      { id: "ca_1111111111", toolkit: "gmail", status: "EXPIRED", createdAt: null },
      { id: "ca_2222222222", toolkit: "gmail", status: "ACTIVE", createdAt: null },
      { id: "ca_3333333333", toolkit: "slack", status: "INITIATED", createdAt: null },
      { id: "ca_4444444444", toolkit: "", status: "ACTIVE", createdAt: null },
    ]);
    expect(g.map((x) => [x.toolkit, x.status, x.accountId, x.accounts])).toEqual([
      ["gmail", "ACTIVE", "ca_2222222222", 2],
      ["slack", "PENDING", "ca_3333333333", 1],
    ]);
    expect(appStatus("failed")).toBe("EXPIRED");
  });

  it("masks account ids", () => {
    expect(maskId("ca_abcdefghijkl")).toBe("ca_a…ijkl");
    expect(maskId("short")).toBe("••••");
  });
});
