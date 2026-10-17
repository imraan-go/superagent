import { z } from 'zod';

/*
 * Read-only Composio REST v3.1 client for the app catalog (toolkits, their tools and trigger
 * types), keyed with the installation's COMPOSIO_API_KEY. Account connection and tool execution
 * go through @superagent/connectors (per-user sessions, ownership-verified), never through here.
 */

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
export const COMPOSIO_BASE = 'https://backend.composio.dev/api/v3.1';
/** Single-owner product: one Composio user id. */

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
        categories: z
          .array(z.object({ name: z.string(), slug: z.string().optional(), id: z.string().optional() }).passthrough())
          .optional(),
      })
      .passthrough()
      .optional(),
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

export type ComposioToolkit = z.infer<typeof toolkitSchema>;
export type ComposioTool = z.infer<typeof toolSchema>;
export type ComposioTriggerType = z.infer<typeof triggerTypeSchema>;

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
      method: init.method ?? 'GET',
      headers: {
        'x-api-key': this.apiKey,
        accept: 'application/json',
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
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

  private async paged<T extends z.ZodTypeAny>(
    path: string,
    item: T,
    params: URLSearchParams,
    pageSize = 100,
  ): Promise<Array<z.infer<T>>> {
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
      q.set('limit', String(pageSize));
      if (cursor) q.set('cursor', cursor);
      const data = page(item).parse(await this.request(`${path}?${q.toString()}`));
      out.push(...data.items);
      if (total === null && typeof data.total_items === 'number') total = data.total_items;
      cursor = data.next_cursor;
      if (!cursor) break;
    }
    return { items: out, total };
  }

  /* ---------------------------------------------------------- toolkits -- */

  /** The FULL catalog, paginated. */
  listAllToolkits(): Promise<ComposioToolkit[]> {
    return this.paged('/toolkits', toolkitSchema, new URLSearchParams({ sort_by: 'usage', managed_by: 'all' }), 200);
  }

  /** The full catalog plus Composio's reported `total_items`, so callers can prove nothing was missed. */
  listAllToolkitsWithTotal(): Promise<{ items: ComposioToolkit[]; total: number | null }> {
    return this.pagedWithTotal(
      '/toolkits',
      toolkitSchema,
      new URLSearchParams({ sort_by: 'usage', managed_by: 'all' }),
      200,
    );
  }

  async listCategories(): Promise<Array<{ id: string; name: string }>> {
    const data = page(z.object({ id: z.string(), name: z.string() }).passthrough()).parse(
      await this.request('/toolkits/categories'),
    );
    return data.items.map((c) => ({ id: c.id, name: c.name }));
  }

  async getToolkit(slug: string): Promise<{
    slug: string;
    name?: string | undefined;
    composioManagedAuthSchemes: string[];
    authConfigDetails: Array<{
      mode: string;
      initiationFields: Array<{ name: string; displayName: string; required: boolean; secret: boolean }>;
    }>;
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
                        required: z
                          .array(
                            z
                              .object({
                                name: z.string(),
                                displayName: z.string().optional(),
                                is_secret: z.boolean().optional(),
                              })
                              .passthrough(),
                          )
                          .default([]),
                        optional: z
                          .array(
                            z
                              .object({
                                name: z.string(),
                                displayName: z.string().optional(),
                                is_secret: z.boolean().optional(),
                              })
                              .passthrough(),
                          )
                          .default([]),
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
        ].map((f) => ({
          name: f.name,
          displayName: f.displayName ?? f.name,
          required: f.required,
          secret: f.is_secret ?? false,
        })),
      })),
    };
  }

  /* ---------------------------------------------------- auth configs -- */

  /* ------------------------------------------------ connected accounts -- */

  /* -------------------------------------------------------------- tools -- */

  /** Every tool of a toolkit (latest version), paginated. */
  async listTools(toolkit: string): Promise<ComposioTool[]> {
    const tools = await this.paged(
      '/tools',
      toolSchema,
      new URLSearchParams({ toolkit_slug: toolkit, toolkit_versions: 'latest' }),
      100,
    );
    return tools.filter((t) => t.is_deprecated !== true);
  }

  /* --------------------------------------------------------------- mcp -- */

  /* ---------------------------------------------------------- triggers -- */

  async listTriggerTypes(toolkits: string[]): Promise<ComposioTriggerType[]> {
    if (toolkits.length === 0) return [];
    const params = new URLSearchParams();
    for (const t of toolkits) params.append('toolkit_slugs', t);
    return this.paged('/triggers_types', triggerTypeSchema, params, 100);
  }
}
