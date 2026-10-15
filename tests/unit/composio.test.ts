import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { COMPOSIO_BASE, ComposioClient } from "@/server/connectors/composio-client";
import { normalizeToolkit, orderCatalog, queryCatalog } from "@/server/connectors/composio-catalog";
import { applyBudget, estimateTokens, selectedActions, slimSchema, toolRow } from "@/server/connectors/composio-schema";
import { parseTriggerEnvelope, verifyComposioSignature } from "@/server/connectors/composio-webhook";
import { externalApproval } from "@/server/connectors/external-approval";
import { composioActionName, isComposioReadAction, namespacedTool } from "@/server/connectors/naming";

interface Call {
  url: string;
  init: RequestInit;
}
function mockFetch(responses: Array<() => Response>) {
  const calls: Call[] = [];
  let i = 0;
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    const r = responses[Math.min(i, responses.length - 1)]!;
    i += 1;
    return r();
  };
  return { fn, calls };
}
const ok = (body: unknown) => () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const bodyOf = (c: Call) => JSON.parse(String(c.init.body)) as Record<string, unknown>;
const hdr = (c: Call) => c.init.headers as Record<string, string>;

describe("Composio v3.1 client", () => {
  it("uses the v3.1 base and the x-api-key header", async () => {
    const { fn, calls } = mockFetch([ok({ items: [] })]);
    await new ComposioClient("ck_test", fn).listConnectedAccounts();
    expect(COMPOSIO_BASE).toBe("https://backend.composio.dev/api/v3.1");
    expect(calls[0]!.url).toBe(`${COMPOSIO_BASE}/connected_accounts?user_ids=owner&limit=100`);
    expect(hdr(calls[0]!)["x-api-key"]).toBe("ck_test");
  });

  it("paginates the whole toolkit catalog with next_cursor", async () => {
    const { fn, calls } = mockFetch([
      ok({ items: [{ slug: "gmail" }], next_cursor: "c2" }),
      ok({ items: [{ slug: "notion" }], next_cursor: null }),
    ]);
    const all = await new ComposioClient("k", fn).listAllToolkits();
    expect(all.map((t) => t.slug)).toEqual(["gmail", "notion"]);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toContain("/toolkits?");
    expect(calls[0]!.url).toContain("limit=200");
    expect(calls[1]!.url).toContain("cursor=c2");
  });

  it("lists categories and fetches one toolkit's auth details", async () => {
    const cats = mockFetch([ok({ items: [{ id: "email", name: "Email" }] })]);
    expect(await new ComposioClient("k", cats.fn).listCategories()).toEqual([{ id: "email", name: "Email" }]);
    expect(cats.calls[0]!.url).toBe(`${COMPOSIO_BASE}/toolkits/categories`);

    const tk = mockFetch([
      ok({
        slug: "serpapi",
        composio_managed_auth_schemes: [],
        auth_config_details: [
          { mode: "API_KEY", fields: { connected_account_initiation: { required: [{ name: "generic_api_key", displayName: "API Key", is_secret: true }], optional: [] } } },
        ],
      }),
    ]);
    const d = await new ComposioClient("k", tk.fn).getToolkit("serpapi");
    expect(tk.calls[0]!.url).toBe(`${COMPOSIO_BASE}/toolkits/serpapi`);
    expect(d.authConfigDetails[0]).toEqual({
      mode: "API_KEY",
      initiationFields: [{ name: "generic_api_key", displayName: "API Key", required: true, secret: true }],
    });
  });

  it("re-uses a managed auth config, else creates one", async () => {
    const reuse = mockFetch([ok({ items: [{ id: "ac_old", is_composio_managed: true, status: "ENABLED" }] })]);
    expect((await new ComposioClient("k", reuse.fn).ensureAuthConfig("gmail", "managed")).id).toBe("ac_old");
    expect(reuse.calls[0]!.url).toContain("/auth_configs?toolkit_slug=gmail");

    const create = mockFetch([ok({ items: [] }), ok({ auth_config: { id: "ac_new" } })]);
    expect((await new ComposioClient("k", create.fn).ensureAuthConfig("gmail", "managed")).id).toBe("ac_new");
    expect(create.calls[1]!.init.method).toBe("POST");
    expect(bodyOf(create.calls[1]!)).toEqual({ toolkit: { slug: "gmail" }, auth_config: { type: "use_composio_managed_auth" } });
  });

  it("creates a hosted connect link for user owner", async () => {
    const { fn, calls } = mockFetch([ok({ redirect_url: "https://connect.composio.dev/x", connected_account_id: "ca_1", link_token: "t" })]);
    const r = await new ComposioClient("k", fn).createConnectLink("ac_1", "https://panel.example/cb");
    expect(r).toEqual({ accountId: "ca_1", redirectUrl: "https://connect.composio.dev/x" });
    expect(calls[0]!.url).toBe(`${COMPOSIO_BASE}/connected_accounts/link`);
    expect(bodyOf(calls[0]!)).toEqual({ auth_config_id: "ac_1", user_id: "owner", callback_url: "https://panel.example/cb" });
  });

  it("posts credential-style accounts straight to Composio", async () => {
    const { fn, calls } = mockFetch([ok({ id: "ca_9", status: "ACTIVE" })]);
    const r = await new ComposioClient("k", fn).createCredentialAccount("ac_2", "API_KEY", { generic_api_key: "sk-123" });
    expect(r).toEqual({ id: "ca_9", status: "ACTIVE" });
    expect(bodyOf(calls[0]!)).toEqual({
      auth_config: { id: "ac_2" },
      connection: { user_id: "owner", state: { authScheme: "API_KEY", val: { status: "ACTIVE", generic_api_key: "sk-123" } } },
    });
  });

  it("disconnects with revoke_on_delete", async () => {
    const { fn, calls } = mockFetch([ok({ success: true })]);
    await new ComposioClient("k", fn).disconnect("ca_1");
    expect(calls[0]!.init.method).toBe("DELETE");
    expect(calls[0]!.url).toBe(`${COMPOSIO_BASE}/connected_accounts/ca_1?revoke_on_delete=true`);
  });

  it("lists tools at the latest toolkit version and executes with user_id + version", async () => {
    const list = mockFetch([ok({ items: [{ slug: "GMAIL_FETCH_EMAILS" }, { slug: "GMAIL_OLD", is_deprecated: true }] })]);
    const tools = await new ComposioClient("k", list.fn).listTools("gmail");
    expect(tools.map((t) => t.slug)).toEqual(["GMAIL_FETCH_EMAILS"]);
    expect(list.calls[0]!.url).toContain("toolkit_slug=gmail");
    expect(list.calls[0]!.url).toContain("toolkit_versions=latest");

    const ex = mockFetch([ok({ successful: true, data: { ok: 1 } })]);
    await new ComposioClient("k", ex.fn).executeTool("GMAIL_SEND_EMAIL", { to: "a@b.c" });
    expect(ex.calls[0]!.url).toBe(`${COMPOSIO_BASE}/tools/execute/GMAIL_SEND_EMAIL`);
    expect(ex.calls[0]!.init.method).toBe("POST");
    expect(bodyOf(ex.calls[0]!)).toEqual({ user_id: "owner", arguments: { to: "a@b.c" }, version: "latest" });
  });

  it("surfaces HTTP errors without echoing the key", async () => {
    const { fn } = mockFetch([() => new Response("nope", { status: 401 })]);
    const err = await new ComposioClient("ck_secret_value", fn).listAllToolkits().catch((e: Error) => e);
    expect((err as Error).message).toMatch(/401/);
    expect((err as Error).message).not.toContain("ck_secret_value");
  });

  it("creates, updates and deletes MCP servers; generates the owner URL", async () => {
    const c = mockFetch([
      ok({ id: "srv_1", mcp_url: "https://backend.composio.dev/v3/mcp/srv_1" }),
      ok({ id: "srv_1" }),
      ok({ mcp_url: "https://backend.composio.dev/v3/mcp/srv_1", user_ids_url: ["https://backend.composio.dev/v3/mcp/srv_1?user_id=owner"] }),
      ok({ id: "srv_1", deleted: true }),
    ]);
    const client = new ComposioClient("k", c.fn);
    await client.createMcpServer({ name: "panel", authConfigIds: ["ac_1"], allowedTools: ["GMAIL_FETCH_EMAILS"] });
    expect(c.calls[0]!.url).toBe(`${COMPOSIO_BASE}/mcp/servers`);
    expect(bodyOf(c.calls[0]!)).toMatchObject({ name: "panel", auth_config_ids: ["ac_1"], allowed_tools: ["GMAIL_FETCH_EMAILS"] });
    await client.updateMcpServer("srv_1", { allowedTools: ["X"] });
    expect(c.calls[1]!.url).toBe(`${COMPOSIO_BASE}/mcp/srv_1`);
    expect(c.calls[1]!.init.method).toBe("PATCH");
    expect(await client.generateMcpUrl("srv_1")).toBe("https://backend.composio.dev/v3/mcp/srv_1?user_id=owner");
    expect(c.calls[2]!.url).toBe(`${COMPOSIO_BASE}/mcp/servers/generate`);
    expect(bodyOf(c.calls[2]!)).toMatchObject({ mcp_server_id: "srv_1", user_ids: ["owner"] });
    await client.deleteMcpServer("srv_1");
    expect(c.calls[3]!.init.method).toBe("DELETE");
  });

  it("lists trigger types, upserts and deletes triggers, manages the webhook subscription", async () => {
    const c = mockFetch([
      ok({ items: [{ slug: "GMAIL_NEW_GMAIL_MESSAGE", toolkit: { slug: "gmail" } }] }),
      ok({ trigger_id: "ti_1" }),
      ok({ trigger_id: "ti_1" }),
      ok({ items: [] }),
      ok({ id: "ws_1", secret: "s3cret", webhook_url: "https://p/x" }),
      ok({ success: true }),
    ]);
    const client = new ComposioClient("k", c.fn);
    expect((await client.listTriggerTypes(["gmail", "slack"]))[0]!.slug).toBe("GMAIL_NEW_GMAIL_MESSAGE");
    expect(c.calls[0]!.url).toContain("toolkit_slugs=gmail&toolkit_slugs=slack");
    expect(await client.upsertTrigger("GMAIL_NEW_GMAIL_MESSAGE", "ca_1", { labelIds: "INBOX" })).toBe("ti_1");
    expect(c.calls[1]!.url).toBe(`${COMPOSIO_BASE}/trigger_instances/GMAIL_NEW_GMAIL_MESSAGE/upsert`);
    expect(bodyOf(c.calls[1]!)).toEqual({ connected_account_id: "ca_1", user_id: "owner", trigger_config: { labelIds: "INBOX" } });
    await client.deleteTrigger("ti_1");
    expect(c.calls[2]!.url).toBe(`${COMPOSIO_BASE}/trigger_instances/manage/ti_1`);
    expect(c.calls[2]!.init.method).toBe("DELETE");
    await client.listActiveTriggers();
    expect(c.calls[3]!.url).toContain("/trigger_instances/active?user_ids=owner");
    expect(await client.createWebhookSubscription("https://p/api/webhooks/composio")).toEqual({ id: "ws_1", secret: "s3cret" });
    expect(bodyOf(c.calls[4]!)).toEqual({ webhook_url: "https://p/api/webhooks/composio", enabled_events: ["composio.trigger.message"], version: "V3" });
    await client.deleteWebhookSubscription("ws_1");
    expect(c.calls[5]!.url).toBe(`${COMPOSIO_BASE}/webhook_subscriptions/ws_1`);
  });
});

describe("catalog helpers", () => {
  const mk = (slug: string, name: string, cats: string[] = [], desc = "") =>
    normalizeToolkit({ slug, name, auth_schemes: ["OAUTH2"], composio_managed_auth_schemes: ["OAUTH2"], meta: { description: desc, tools_count: 5, categories: cats.map((c) => ({ name: c })) } });

  it("pins the owner's priority set first, in the owner's order", () => {
    const ordered = orderCatalog([mk("zzz", "Zzz"), mk("hubspot", "HubSpot"), mk("aaa", "Aaa"), mk("gmail", "Gmail"), mk("notion", "Notion")]);
    expect(ordered.map((t) => t.slug)).toEqual(["gmail", "notion", "hubspot", "zzz", "aaa"]);
    expect(ordered[0]!.pinned).toBe(true);
    expect(ordered[3]!.pinned).toBe(false);
  });

  it("searches, filters by category and pages", () => {
    const all = [mk("gmail", "Gmail", ["Email"], "Send mail"), mk("slack", "Slack", ["Chat"], "Team chat"), mk("zoho", "Zoho Mail", ["Email"])];
    expect(queryCatalog(all, { search: "mail" }).items.map((t) => t.slug).sort()).toEqual(["gmail", "zoho"]);
    expect(queryCatalog(all, { category: "email" }).total).toBe(2);
    expect(queryCatalog(all, { offset: 1, limit: 1 }).items.map((t) => t.slug)).toEqual(["slack"]);
    expect(all[0]!.managedAuth).toBe(true);
  });
});

describe("tool selection and schema budget", () => {
  const tool = (slug: string, props = 1) => ({
    slug,
    description: "d".repeat(50),
    input_parameters: { type: "object", title: "X", properties: Object.fromEntries(Array.from({ length: props }, (_, i) => [`p${i}`, { type: "string", title: "T", description: "x".repeat(500) }])) },
  });

  it("strips decoration and clips descriptions", () => {
    const slim = slimSchema(tool("A").input_parameters) as { title?: string; properties: Record<string, { title?: string; description: string }> };
    expect(slim.title).toBeUndefined();
    expect(slim.properties.p0!.title).toBeUndefined();
    expect(slim.properties.p0!.description.length).toBeLessThanOrEqual(140);
  });

  it("defaults to read-only tools, honours an explicit selection", () => {
    const rows = ["GMAIL_FETCH_EMAILS", "GMAIL_SEND_EMAIL", "GMAIL_LIST_LABELS", "GMAIL_CREATE_LABEL"].map((s) => toolRow("gmail", tool(s)));
    expect(selectedActions(rows, undefined).map((r) => r.slug)).toEqual(["GMAIL_FETCH_EMAILS", "GMAIL_LIST_LABELS"]);
    expect(selectedActions(rows, ["GMAIL_SEND_EMAIL"]).map((r) => r.slug)).toEqual(["GMAIL_SEND_EMAIL"]);
    expect(rows[0]!.action).toBe("fetch_emails");
    expect(rows[0]!.schemaTokens).toBeGreaterThan(0);
  });

  it("enforces the token budget, keeping read-only tools first", () => {
    const items = [
      { id: "w", schemaTokens: 60, readOnly: false },
      { id: "r1", schemaTokens: 60, readOnly: true },
      { id: "r2", schemaTokens: 60, readOnly: true },
    ];
    const { kept, dropped } = applyBudget(items, 130);
    expect(kept.map((k) => k.id)).toEqual(["r1", "r2"]);
    expect(dropped).toBe(1);
    expect(estimateTokens({ a: "x".repeat(40) })).toBeGreaterThan(10);
  });
});

describe("approval gate for Composio tools (real slugs)", () => {
  const name = (toolkit: string, slug: string) => namespacedTool("composio", toolkit, composioActionName(slug, toolkit));

  it.each([
    ["gmail", "GMAIL_SEND_EMAIL"],
    ["gmail", "GMAIL_CREATE_EMAIL_DRAFT"],
    ["gmail", "GMAIL_DELETE_MESSAGE"],
    ["linkedin", "LINKEDIN_CREATE_LINKED_IN_POST"],
    ["notion", "NOTION_CREATE_PAGE"],
    ["notion", "NOTION_UPDATE_PAGE"],
    ["slack", "SLACK_SEND_MESSAGE"],
    ["github", "GITHUB_CREATE_AN_ISSUE"],
    ["github", "GITHUB_MERGE_A_PULL_REQUEST"],
    ["googlecalendar", "GOOGLECALENDAR_CREATE_EVENT"],
    ["googledrive", "GOOGLEDRIVE_SHARE_FILE"],
    ["twitter", "TWITTER_CREATION_OF_A_POST"],
    ["instagram", "INSTAGRAM_CREATE_POST"],
    ["hubspot", "HUBSPOT_GET_OR_CREATE_CONTACT"],
    ["outlook", "OUTLOOK_REPLY_EMAIL"],
    ["gmail", "GMAIL_SOMETHING_UNKNOWN"],
  ])("%s %s requires approval", (tk, slug) => {
    expect(externalApproval(name(tk, slug)).required).toBe(true);
  });

  it.each([
    ["gmail", "GMAIL_FETCH_EMAILS"],
    ["gmail", "GMAIL_LIST_LABELS"],
    ["gmail", "GMAIL_GET_PROFILE"],
    ["notion", "NOTION_FETCH_DATA"],
    ["notion", "NOTION_SEARCH_NOTION_PAGE"],
    ["github", "GITHUB_LIST_COMMITS"],
    ["googlesheets", "GOOGLESHEETS_BATCH_GET"],
  ])("%s %s runs without approval", (tk, slug) => {
    expect(externalApproval(name(tk, slug)).required).toBe(false);
  });

  it("gates write tools reached through Composio's hosted MCP too", () => {
    expect(externalApproval("mcp__composio__notion_create_page").required).toBe(true);
    expect(externalApproval("mcp__composio__gmail_fetch_emails").required).toBe(false);
  });

  it("classifies read actions conservatively", () => {
    expect(isComposioReadAction("fetch_emails")).toBe(true);
    expect(isComposioReadAction("get_or_create_contact")).toBe(false);
    expect(isComposioReadAction("list_and_send")).toBe(false);
    expect(isComposioReadAction("archive_thread")).toBe(false);
  });
});

describe("Composio webhook signature (Standard-Webhooks)", () => {
  const secret = "whsec_test_secret";
  const body = JSON.stringify({ id: "e1", type: "composio.trigger.message", metadata: { trigger_id: "ti_1", trigger_slug: "GMAIL_NEW_GMAIL_MESSAGE" }, data: { subject: "hi" } });
  const sign = (id: string, ts: string, raw: string, key = secret) => `v1,${createHmac("sha256", key).update(`${id}.${ts}.${raw}`).digest("base64")}`;
  const now = 1_800_000_000;
  const ts = String(now);

  it("accepts a valid signature and rejects tampering, staleness and missing headers", () => {
    const base = { secret, id: "msg_1", timestamp: ts, signature: sign("msg_1", ts, body), rawBody: body, nowMs: now * 1000 };
    expect(verifyComposioSignature(base)).toBe(true);
    expect(verifyComposioSignature({ ...base, rawBody: body + " " })).toBe(false);
    expect(verifyComposioSignature({ ...base, id: "msg_2" })).toBe(false);
    expect(verifyComposioSignature({ ...base, nowMs: (now + 301) * 1000 })).toBe(false);
    expect(verifyComposioSignature({ ...base, signature: null })).toBe(false);
    expect(verifyComposioSignature({ ...base, secret: "other" })).toBe(false);
  });

  it("accepts one of several space-separated signatures", () => {
    const sig = `v1,AAAA ${sign("m", ts, body)}`;
    expect(verifyComposioSignature({ secret, id: "m", timestamp: ts, signature: sig, rawBody: body, nowMs: now * 1000 })).toBe(true);
  });

  it("extracts the trigger id from a V3 envelope", () => {
    expect(parseTriggerEnvelope(body)).toEqual({ triggerId: "ti_1", slug: "GMAIL_NEW_GMAIL_MESSAGE" });
    expect(parseTriggerEnvelope("{}")).toBeNull();
    expect(parseTriggerEnvelope("not json")).toBeNull();
  });
});
