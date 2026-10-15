import { z } from "zod";

/**
 * Minimal MCP Streamable-HTTP client: `initialize` → `notifications/initialized`
 * → `tools/list` / `tools/call`. Pure (fetch injected) and unit-tested.
 *
 * The server may answer a POST with plain JSON or with an SSE stream; both
 * are handled. `@modelcontextprotocol/sdk` is not a dependency, deliberately —
 * three methods do not justify it.
 */
export const MCP_PROTOCOL_VERSION = "2025-06-18";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const rpcResponse = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: z.union([z.number(), z.string()]).nullable().optional(),
    result: z.unknown().optional(),
    error: z.object({ code: z.number(), message: z.string() }).passthrough().optional(),
  })
  .passthrough();

const toolSchema = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    inputSchema: z.record(z.string(), z.unknown()).optional(),
    annotations: z.object({ readOnlyHint: z.boolean().optional() }).passthrough().optional(),
  })
  .passthrough();

export type McpTool = z.infer<typeof toolSchema>;

const callResult = z
  .object({
    content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()).default([]),
    isError: z.boolean().optional(),
  })
  .passthrough();

export class McpError extends Error {}

/** Extracts the JSON-RPC message with `id` from a JSON or SSE body. */
export function parseRpcBody(body: string, contentType: string, id: number): z.infer<typeof rpcResponse> {
  const candidates: unknown[] = [];
  if (contentType.includes("text/event-stream")) {
    for (const block of body.split(/\r?\n\r?\n/)) {
      const data = block
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (data) {
        try {
          candidates.push(JSON.parse(data));
        } catch {
          /* ignore keep-alives */
        }
      }
    }
  } else {
    const parsed: unknown = JSON.parse(body);
    candidates.push(...(Array.isArray(parsed) ? parsed : [parsed]));
  }
  for (const c of candidates) {
    const r = rpcResponse.safeParse(c);
    if (r.success && r.data.id === id) return r.data;
  }
  throw new McpError("MCP server returned no response for the request.");
}

export class McpClient {
  private sessionId: string | null = null;
  private nextId = 1;
  private initialized = false;

  constructor(
    private readonly url: string,
    private readonly bearer: string | null,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly timeoutMs = 30_000,
    private readonly extraHeaders: Record<string, string> = {},
  ) {}

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": MCP_PROTOCOL_VERSION,
      ...this.extraHeaders,
      ...(this.bearer ? { authorization: `Bearer ${this.bearer}` } : {}),
      ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
    };
  }

  private async rpc(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    const res = await this.fetchImpl(this.url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) }),
      signal: AbortSignal.timeout(this.timeoutMs),
      // A redirect could bounce a vetted public URL to a private host (SSRF).
      redirect: "error",
    });
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;
    const text = await res.text();
    if (!res.ok) throw new McpError(`MCP ${method} failed: HTTP ${res.status}`);
    const msg = parseRpcBody(text, res.headers.get("content-type") ?? "", id);
    if (msg.error) throw new McpError(`MCP ${method}: ${msg.error.message}`);
    return msg.result;
  }

  private async notify(method: string): Promise<void> {
    const res = await this.fetchImpl(this.url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ jsonrpc: "2.0", method }),
      signal: AbortSignal.timeout(this.timeoutMs),
      // A redirect could bounce a vetted public URL to a private host (SSRF).
      redirect: "error",
    });
    await res.text().catch(() => "");
  }

  async initialize(): Promise<{ serverName: string | null }> {
    if (this.initialized) return { serverName: null };
    const result = z
      .object({ serverInfo: z.object({ name: z.string() }).passthrough().optional() })
      .passthrough()
      .parse(
        await this.rpc("initialize", {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "flight-deck-panel", version: "0.1.0" },
        }),
      );
    await this.notify("notifications/initialized");
    this.initialized = true;
    return { serverName: result.serverInfo?.name ?? null };
  }

  async listTools(): Promise<McpTool[]> {
    await this.initialize();
    const out: McpTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const r = z
        .object({ tools: z.array(toolSchema).default([]), nextCursor: z.string().optional() })
        .passthrough()
        .parse(await this.rpc("tools/list", cursor ? { cursor } : {}));
      out.push(...r.tools);
      if (!r.nextCursor) break;
      cursor = r.nextCursor;
    }
    return out;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; text: string }> {
    await this.initialize();
    const r = callResult.parse(await this.rpc("tools/call", { name, arguments: args }));
    const text = r.content
      .map((c) => (c.type === "text" ? (c.text ?? "") : `[${c.type} content]`))
      .join("\n");
    return { ok: !r.isError, text };
  }
}
