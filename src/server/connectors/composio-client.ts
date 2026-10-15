import { z } from "zod";

/**
 * Plain-REST Composio v3 client (INTEGRATIONS.md §4). Pure — the key and
 * `fetch` are injected, so request shaping is unit-tested with a mock fetch.
 *
 * Implemented conservatively against the v3 API (`x-api-key` header,
 * `https://backend.composio.dev/api/v3`). Every response is parsed loosely
 * (passthrough) so additive upstream changes never crash the panel.
 */
export const COMPOSIO_BASE = "https://backend.composio.dev/api/v3";
/** Single-owner product: one Composio user id. */
export const COMPOSIO_USER_ID = "owner";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const listOf = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item).default([]) }).passthrough();

const toolkitSchema = z
  .object({
    slug: z.string(),
    name: z.string().optional(),
    meta: z.object({ description: z.string().optional(), logo: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

const accountSchema = z
  .object({
    id: z.string(),
    status: z.string().optional(),
    toolkit: z.object({ slug: z.string() }).passthrough().optional(),
  })
  .passthrough();

const toolSchema = z
  .object({
    slug: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    input_parameters: z.record(z.string(), z.unknown()).optional(),
    toolkit: z.object({ slug: z.string() }).passthrough().optional(),
  })
  .passthrough();

export type ComposioToolkit = z.infer<typeof toolkitSchema>;
export type ComposioAccount = z.infer<typeof accountSchema>;
export type ComposioTool = z.infer<typeof toolSchema>;

export class ComposioError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

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
      // Never echo request headers; the upstream message is enough.
      throw new ComposioError(`Composio ${res.status}: ${text.slice(0, 300)}`, res.status);
    }
    return text ? (JSON.parse(text) as unknown) : {};
  }

  async listToolkits(limit = 50): Promise<ComposioToolkit[]> {
    const data = await this.request(`/toolkits?limit=${limit}`);
    return listOf(toolkitSchema).parse(data).items;
  }

  async listConnectedAccounts(): Promise<ComposioAccount[]> {
    const data = await this.request(
      `/connected_accounts?user_ids=${encodeURIComponent(COMPOSIO_USER_ID)}&statuses=ACTIVE&statuses=INITIATED`,
    );
    return listOf(accountSchema).parse(data).items;
  }

  /**
   * Starts the hosted OAuth flow: ensure a Composio-managed auth config for
   * the toolkit, then create a connected account and return its redirect URL.
   */
  async connect(toolkit: string, callbackUrl?: string): Promise<{ id: string; redirectUrl: string | null }> {
    const cfg = z
      .object({ auth_config: z.object({ id: z.string() }).passthrough() })
      .passthrough()
      .parse(
        await this.request("/auth_configs", {
          method: "POST",
          body: { toolkit: { slug: toolkit }, auth_config: { type: "use_composio_managed_auth" } },
        }),
      );

    const acc = z
      .object({ id: z.string(), redirect_url: z.string().nullish(), redirect_uri: z.string().nullish() })
      .passthrough()
      .parse(
        await this.request("/connected_accounts", {
          method: "POST",
          body: {
            auth_config: { id: cfg.auth_config.id },
            connection: {
              user_id: COMPOSIO_USER_ID,
              ...(callbackUrl ? { callback_url: callbackUrl } : {}),
            },
          },
        }),
      );
    return { id: acc.id, redirectUrl: acc.redirect_url ?? acc.redirect_uri ?? null };
  }

  async disconnect(accountId: string): Promise<void> {
    await this.request(`/connected_accounts/${encodeURIComponent(accountId)}`, { method: "DELETE" });
  }

  async listTools(toolkit: string, limit = 25): Promise<ComposioTool[]> {
    const data = await this.request(
      `/tools?toolkit_slug=${encodeURIComponent(toolkit)}&limit=${limit}`,
    );
    return listOf(toolSchema).parse(data).items;
  }

  async executeTool(toolSlug: string, args: Record<string, unknown>): Promise<unknown> {
    return this.request(`/tools/execute/${encodeURIComponent(toolSlug)}`, {
      method: "POST",
      body: { user_id: COMPOSIO_USER_ID, arguments: args },
    });
  }
}
