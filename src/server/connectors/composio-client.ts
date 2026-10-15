import { z } from "zod";

/**
 * Plain-REST Composio v3.1 client (docs/INTEGRATIONS.md §4). Pure — the key and
 * `fetch` are injected, so request shaping is unit-tested with a mock fetch.
 *
 * Endpoints verified against the live OpenAPI document
 * (https://backend.composio.dev/api/v3.1/openapi.json): auth is the
 * `x-api-key` header; lists are cursor-paginated (`limit`, `cursor` →
 * `next_cursor`); MCP lists use `page_no`. Every response is parsed loosely
 * (passthrough) so additive upstream changes never crash the panel.
 */
export const COMPOSIO_BASE = "https://backend.composio.dev/api/v3.1";
/** Single-owner product: one Composio user id. */
export const COMPOSIO_USER_ID = "owner";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const page = <T extends z.ZodTypeAny>(item: T) =>
  z
    .object({
      items: z.array(item).default([]),
      next_cursor: z.string().nullish(),
      total_items: z.number().optional(),
    })
    .passthrough();

const toolkitSchema = z
  .object({
    slug: z.string(),
    name: z.string().optional(),
    auth_schemes: z.array(z.string()).optional(),
    composio_managed_auth_schemes: z.array(z.string()).optional(),
    no_auth: z.boolean().optional(),
    auth_guide_url: z.string().nullish(),
    meta: z
      .object({
        description: z.string().optional(),
        logo: z.string().optional(),
        tools_count: z.number().optional(),
        triggers_count: z.number().optional(),
        categories: z.array(z.object({ name: z.string(), slug: z.string().optional(), id: z.string().optional() }).passthrough()).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const accountSchema = z
  .object({
    id: z.string(),
    status: z.string().optional(),
    status_reason: z.string().nullish(),
    toolkit: z.object({ slug: z.string() }).passthrough().optional(),
    auth_config: z.object({ id: z.string(), auth_scheme: z.string().optional() }).passthrough().optional(),
    created_at: z.string().optional(),
  })
  .passthrough();

const toolSchema = z
  .object({
    slug: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    input_parameters: z.record(z.string(), z.unknown()).optional(),
    toolkit: z.object({ slug: z.string() }).passthrough().optional(),
    tags: z.array(z.string()).optional(),
    is_deprecated: z.boolean().optional(),
  })
  .passthrough();

const authConfigSchema = z
  .object({
    id: z.string(),
    auth_scheme: z.string().optional(),
    is_composio_managed: z.boolean().optional(),
    status: z.string().optional(),
    toolkit: z.object({ slug: z.string() }).passthrough().optional(),
    expected_input_fields: z
      .array(
        z
          .object({
            name: z.string(),
            displayName: z.string().optional(),
            description: z.string().optional(),
            required: z.boolean().optional(),
            is_secret: z.boolean().optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

const mcpServerSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    mcp_url: z.string().optional(),
    toolkits: z.array(z.string()).optional(),
    allowed_tools: z.array(z.string()).optional(),
    auth_config_ids: z.array(z.string()).optional(),
  })
  .passthrough();

const triggerTypeSchema = z
  .object({
    slug: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    type: z.string().optional(),
    toolkit: z.object({ slug: z.string() }).passthrough().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const activeTriggerSchema = z
  .object({
    id: z.string(),
    trigger_name: z.string().optional(),
    connected_account_id: z.string().optional(),
    disabled_at: z.string().nullish(),
    trigger_config: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export type ComposioToolkit = z.infer<typeof toolkitSchema>;
export type ComposioAccount = z.infer<typeof accountSchema>;
export type ComposioTool = z.infer<typeof toolSchema>;
export type ComposioAuthConfig = z.infer<typeof authConfigSchema>;
export type ComposioMcpServer = z.infer<typeof mcpServerSchema>;
export type ComposioTriggerType = z.infer<typeof triggerTypeSchema>;
export type ComposioActiveTrigger = z.infer<typeof activeTriggerSchema>;

export class ComposioError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Hard ceiling on auto-pagination so a misbehaving cursor can never loop forever. */
const MAX_PAGES = 40;

export class ComposioClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly base: string = COMPOSIO_BASE,
  ) {}

  private async request(path: string, init: { method?: string; body?: unknown } = {}): Promise<unknown> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method: init.method ?? "GET",
      headers: {
        "x-api-key": this.apiKey,
        accept: "application/json",
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    if (!res.ok) {
      // Never echo request headers or bodies; the upstream message is enough.
      throw new ComposioError(`Composio ${res.status}: ${text.slice(0, 300)}`, res.status);
    }
    return text ? (JSON.parse(text) as unknown) : {};
  }

  private async paged<T extends z.ZodTypeAny>(path: string, item: T, params: URLSearchParams, pageSize = 100): Promise<Array<z.infer<T>>> {
    return (await this.pagedWithTotal(path, item, params, pageSize)).items;
  }

  /** Same walk as `paged`, also returning Composio's own `total_items` (from the first page) when it reports one. */
  private async pagedWithTotal<T extends z.ZodTypeAny>(
    path: string,
    item: T,
    params: URLSearchParams,
    pageSize = 100,
  ): Promise<{ items: Array<z.infer<T>>; total: number | null }> {
    const out: Array<z.infer<T>> = [];
    let total: number | null = null;
    let cursor: string | null | undefined;
    for (let i = 0; i < MAX_PAGES; i += 1) {
      const q = new URLSearchParams(params);
      q.set("limit", String(pageSize));
      if (cursor) q.set("cursor", cursor);
      const data = page(item).parse(await this.request(`${path}?${q.toString()}`));
      out.push(...data.items);
      if (total === null && typeof data.total_items === "number") total = data.total_items;
      cursor = data.next_cursor;
      if (!cursor) break;
    }
    return { items: out, total };
  }

  /* ---------------------------------------------------------- toolkits -- */

  /** The FULL catalog, paginated. */
  listAllToolkits(): Promise<ComposioToolkit[]> {
    return this.paged("/toolkits", toolkitSchema, new URLSearchParams({ sort_by: "usage", managed_by: "all" }), 200);
  }

  /** The full catalog plus Composio's reported `total_items`, so callers can prove nothing was missed. */
  listAllToolkitsWithTotal(): Promise<{ items: ComposioToolkit[]; total: number | null }> {
    return this.pagedWithTotal("/toolkits", toolkitSchema, new URLSearchParams({ sort_by: "usage", managed_by: "all" }), 200);
  }

  async listCategories(): Promise<Array<{ id: string; name: string }>> {
    const data = page(z.object({ id: z.string(), name: z.string() }).passthrough()).parse(await this.request("/toolkits/categories"));
    return data.items.map((c) => ({ id: c.id, name: c.name }));
  }

  async getToolkit(slug: string): Promise<{
    slug: string;
    name?: string | undefined;
    composioManagedAuthSchemes: string[];
    authConfigDetails: Array<{ mode: string; initiationFields: Array<{ name: string; displayName: string; required: boolean; secret: boolean }> }>;
    authGuideUrl: string | null;
  }> {
    const raw = z
      .object({
        slug: z.string(),
        name: z.string().optional(),
        composio_managed_auth_schemes: z.array(z.string()).default([]),
        auth_guide_url: z.string().nullish(),
        auth_config_details: z
          .array(
            z
              .object({
                mode: z.string(),
                fields: z
                  .object({
                    connected_account_initiation: z
                      .object({
                        required: z.array(z.object({ name: z.string(), displayName: z.string().optional(), is_secret: z.boolean().optional() }).passthrough()).default([]),
                        optional: z.array(z.object({ name: z.string(), displayName: z.string().optional(), is_secret: z.boolean().optional() }).passthrough()).default([]),
                      })
                      .passthrough()
                      .optional(),
                  })
                  .passthrough()
                  .optional(),
              })
              .passthrough(),
          )
          .default([]),
      })
      .passthrough()
      .parse(await this.request(`/toolkits/${encodeURIComponent(slug)}`));
    return {
      slug: raw.slug,
      name: raw.name,
      composioManagedAuthSchemes: raw.composio_managed_auth_schemes,
      authGuideUrl: raw.auth_guide_url ?? null,
      authConfigDetails: raw.auth_config_details.map((d) => ({
        mode: d.mode,
        initiationFields: [
          ...(d.fields?.connected_account_initiation?.required ?? []).map((f) => ({ ...f, required: true })),
          ...(d.fields?.connected_account_initiation?.optional ?? []).map((f) => ({ ...f, required: false })),
        ].map((f) => ({ name: f.name, displayName: f.displayName ?? f.name, required: f.required, secret: f.is_secret ?? false })),
      })),
    };
  }

  /* ---------------------------------------------------- auth configs -- */

  async listAuthConfigs(toolkit: string): Promise<ComposioAuthConfig[]> {
    return this.paged("/auth_configs", authConfigSchema, new URLSearchParams({ toolkit_slug: toolkit }), 50);
  }

  async createAuthConfig(toolkit: string, kind: "managed" | { scheme: string }): Promise<ComposioAuthConfig> {
    const auth_config =
      kind === "managed"
        ? { type: "use_composio_managed_auth" }
        : { type: "use_custom_auth", authScheme: kind.scheme };
    const res = z
      .object({ auth_config: authConfigSchema })
      .passthrough()
      .parse(await this.request("/auth_configs", { method: "POST", body: { toolkit: { slug: toolkit }, auth_config } }));
    return res.auth_config;
  }

  /** Re-use an enabled auth config of the right kind, else create one. */
  async ensureAuthConfig(toolkit: string, kind: "managed" | { scheme: string }): Promise<ComposioAuthConfig> {
    const existing = (await this.listAuthConfigs(toolkit)).find((c) => {
      if ((c.status ?? "ENABLED") !== "ENABLED") return false;
      return kind === "managed" ? c.is_composio_managed === true : c.is_composio_managed !== true && c.auth_scheme === kind.scheme;
    });
    return existing ?? this.createAuthConfig(toolkit, kind);
  }

  /* ------------------------------------------------ connected accounts -- */

  async listConnectedAccounts(): Promise<ComposioAccount[]> {
    return this.paged("/connected_accounts", accountSchema, new URLSearchParams({ user_ids: COMPOSIO_USER_ID }), 100);
  }

  /** Hosted "Connect Link": returns the URL the owner opens to authorise. */
  async createConnectLink(authConfigId: string, callbackUrl?: string): Promise<{ accountId: string; redirectUrl: string }> {
    const res = z
      .object({ redirect_url: z.string(), connected_account_id: z.string() })
      .passthrough()
      .parse(
        await this.request("/connected_accounts/link", {
          method: "POST",
          body: {
            auth_config_id: authConfigId,
            user_id: COMPOSIO_USER_ID,
            ...(callbackUrl ? { callback_url: callbackUrl } : {}),
          },
        }),
      );
    return { accountId: res.connected_account_id, redirectUrl: res.redirect_url };
  }

  /**
   * Credential-style toolkits: the values go straight to Composio. The caller
   * must not log or persist `fields`.
   */
  async createCredentialAccount(
    authConfigId: string,
    scheme: "API_KEY" | "BEARER_TOKEN" | "BASIC",
    fields: Record<string, string>,
  ): Promise<{ id: string; status: string }> {
    const res = z
      .object({ id: z.string(), status: z.string().optional() })
      .passthrough()
      .parse(
        await this.request("/connected_accounts", {
          method: "POST",
          body: {
            auth_config: { id: authConfigId },
            connection: { user_id: COMPOSIO_USER_ID, state: { authScheme: scheme, val: { status: "ACTIVE", ...fields } } },
          },
        }),
      );
    return { id: res.id, status: res.status ?? "UNKNOWN" };
  }

  async disconnect(accountId: string): Promise<void> {
    await this.request(`/connected_accounts/${encodeURIComponent(accountId)}?revoke_on_delete=true`, { method: "DELETE" });
  }

  /* -------------------------------------------------------------- tools -- */

  /** Every tool of a toolkit (latest version), paginated. */
  async listTools(toolkit: string): Promise<ComposioTool[]> {
    const tools = await this.paged(
      "/tools",
      toolSchema,
      new URLSearchParams({ toolkit_slug: toolkit, toolkit_versions: "latest" }),
      100,
    );
    return tools.filter((t) => t.is_deprecated !== true);
  }

  async executeTool(toolSlug: string, args: Record<string, unknown>): Promise<unknown> {
    return this.request(`/tools/execute/${encodeURIComponent(toolSlug)}`, {
      method: "POST",
      body: { user_id: COMPOSIO_USER_ID, arguments: args, version: "latest" },
    });
  }

  /* --------------------------------------------------------------- mcp -- */

  async listMcpServers(): Promise<ComposioMcpServer[]> {
    const data = z.object({ items: z.array(mcpServerSchema).default([]) }).passthrough().parse(await this.request("/mcp/servers?limit=50"));
    return data.items;
  }

  async createMcpServer(input: { name: string; authConfigIds: string[]; allowedTools?: string[] }): Promise<ComposioMcpServer> {
    return mcpServerSchema.parse(
      await this.request("/mcp/servers", {
        method: "POST",
        body: {
          name: input.name,
          auth_config_ids: input.authConfigIds,
          ...(input.allowedTools?.length ? { allowed_tools: input.allowedTools } : {}),
          managed_auth_via_composio: false,
        },
      }),
    );
  }

  async updateMcpServer(id: string, patch: { allowedTools?: string[]; authConfigIds?: string[] }): Promise<ComposioMcpServer> {
    return mcpServerSchema.parse(
      await this.request(`/mcp/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: {
          ...(patch.allowedTools ? { allowed_tools: patch.allowedTools } : {}),
          ...(patch.authConfigIds ? { auth_config_ids: patch.authConfigIds } : {}),
        },
      }),
    );
  }

  /** The per-user MCP URL for the owner. */
  async generateMcpUrl(serverId: string): Promise<string> {
    const res = z
      .object({ mcp_url: z.string().optional(), user_ids_url: z.array(z.string()).optional() })
      .passthrough()
      .parse(
        await this.request("/mcp/servers/generate", {
          method: "POST",
          body: { mcp_server_id: serverId, user_ids: [COMPOSIO_USER_ID], managed_auth_by_composio: false },
        }),
      );
    const url = res.user_ids_url?.[0] ?? res.mcp_url;
    if (!url) throw new ComposioError("Composio returned no MCP URL.", 502);
    return url;
  }

  async deleteMcpServer(id: string): Promise<void> {
    await this.request(`/mcp/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  /* ---------------------------------------------------------- triggers -- */

  async listTriggerTypes(toolkits: string[]): Promise<ComposioTriggerType[]> {
    if (toolkits.length === 0) return [];
    const params = new URLSearchParams();
    for (const t of toolkits) params.append("toolkit_slugs", t);
    return this.paged("/triggers_types", triggerTypeSchema, params, 100);
  }

  async listActiveTriggers(): Promise<ComposioActiveTrigger[]> {
    return this.paged("/trigger_instances/active", activeTriggerSchema, new URLSearchParams({ user_ids: COMPOSIO_USER_ID, show_disabled: "true" }), 100);
  }

  async upsertTrigger(slug: string, connectedAccountId: string, config: Record<string, unknown> = {}): Promise<string> {
    const res = z
      .object({ trigger_id: z.string() })
      .passthrough()
      .parse(
        await this.request(`/trigger_instances/${encodeURIComponent(slug)}/upsert`, {
          method: "POST",
          body: { connected_account_id: connectedAccountId, user_id: COMPOSIO_USER_ID, trigger_config: config },
        }),
      );
    return res.trigger_id;
  }

  async deleteTrigger(triggerId: string): Promise<void> {
    await this.request(`/trigger_instances/manage/${encodeURIComponent(triggerId)}`, { method: "DELETE" });
  }

  async listWebhookSubscriptions(): Promise<Array<{ id: string; webhook_url: string }>> {
    const data = page(z.object({ id: z.string(), webhook_url: z.string() }).passthrough()).parse(await this.request("/webhook_subscriptions?limit=50"));
    return data.items;
  }

  /** The signing `secret` is returned by Composio on create and is sealed by the caller. */
  async createWebhookSubscription(webhookUrl: string): Promise<{ id: string; secret: string }> {
    const res = z
      .object({ id: z.string(), secret: z.string() })
      .passthrough()
      .parse(
        await this.request("/webhook_subscriptions", {
          method: "POST",
          body: { webhook_url: webhookUrl, enabled_events: ["composio.trigger.message"], version: "V3" },
        }),
      );
    return { id: res.id, secret: res.secret };
  }

  async deleteWebhookSubscription(id: string): Promise<void> {
    await this.request(`/webhook_subscriptions/${encodeURIComponent(id)}`, { method: "DELETE" });
  }
}
