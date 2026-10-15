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

/** The server no longer knows our session id (HTTP 404); internal to the client. */
class SessionExpired extends McpError {}

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

export interface RpcOptions {
  /** Caller cancellation (e.g. the run was stopped); combined with the timeout. */
  signal?: AbortSignal;
  /** Overrides the client's default per-request timeout. */
  timeoutMs?: number;
}

/**
 * One client per server is meant to be kept and reused: the session from
 * `initialize` carries over, so a tool call is a single round trip. If the
 * server drops the session (HTTP 404 on a request carrying it, per the spec),
 * the client re-initializes and retries once.
 */
export class McpClient {
  private sessionId: string | null = null;
  private nextId = 1;
  private initializing: Promise<{ serverName: string | null }> | null = null;

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

  private signal(opts: RpcOptions): AbortSignal {
    const timeout = AbortSignal.timeout(opts.timeoutMs ?? this.timeoutMs);
    return opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  }

  private async post(body: unknown, opts: RpcOptions): Promise<Response> {
    return this.fetchImpl(this.url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: this.signal(opts),
      // A redirect could bounce a vetted public URL to a private host (SSRF).
      redirect: "error",
    });
  }

  private async rpc(method: string, params: unknown, opts: RpcOptions = {}): Promise<unknown> {
    const id = this.nextId++;
    const res = await this.post({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) }, opts);
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;
    const text = await res.text();
    if (res.status === 404 && this.sessionId && method !== "initialize") throw new SessionExpired();
    if (!res.ok) throw new McpError(`MCP ${method} failed: HTTP ${res.status}`);
    const msg = parseRpcBody(text, res.headers.get("content-type") ?? "", id);
    if (msg.error) throw new McpError(`MCP ${method}: ${msg.error.message}`);
    return msg.result;
  }

  /** `rpc` after initializing; re-initializes once if the server dropped the session. */
  private async session(method: string, params: unknown, opts: RpcOptions): Promise<unknown> {
    await this.initialize();
    try {
      return await this.rpc(method, params, opts);
    } catch (err) {
      if (!(err instanceof SessionExpired)) throw err;
      this.reset();
      await this.initialize();
      try {
        return await this.rpc(method, params, opts);
      } catch (again) {
        if (again instanceof SessionExpired) throw new McpError(`MCP ${method} failed: session not found`);
        throw again;
      }
    }
  }

  private reset(): void {
    this.sessionId = null;
    this.initializing = null;
  }

  /**
   * Idempotent; concurrent callers share one handshake. It runs on the
   * client's own timeout only, so one caller's cancellation cannot fail
   * the handshake another caller is waiting on.
   */
  initialize(): Promise<{ serverName: string | null }> {
    if (!this.initializing) {
      const p = this.handshake({});
      this.initializing = p;
      // A failed handshake must not be cached, or the client is dead for good.
      p.catch(() => {
        if (this.initializing === p) this.initializing = null;
      });
    }
    return this.initializing;
  }

  private async handshake(opts: RpcOptions): Promise<{ serverName: string | null }> {
    const result = z
      .object({ serverInfo: z.object({ name: z.string() }).passthrough().optional() })
      .passthrough()
      .parse(
        await this.rpc(
          "initialize",
          {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "flight-deck-panel", version: "0.1.0" },
          },
          opts,
        ),
      );
    const res = await this.post({ jsonrpc: "2.0", method: "notifications/initialized" }, opts);
    await res.text().catch(() => "");
    return { serverName: result.serverInfo?.name ?? null };
  }

  async listTools(opts: RpcOptions = {}): Promise<McpTool[]> {
    const out: McpTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const r = z
        .object({ tools: z.array(toolSchema).default([]), nextCursor: z.string().optional() })
        .passthrough()
        .parse(await this.session("tools/list", cursor ? { cursor } : {}, opts));
      out.push(...r.tools);
      if (!r.nextCursor) break;
      cursor = r.nextCursor;
    }
    return out;
  }

  async callTool(name: string, args: Record<string, unknown>, opts: RpcOptions = {}): Promise<{ ok: boolean; text: string }> {
    const r = callResult.parse(await this.session("tools/call", { name, arguments: args }, opts));
    const text = r.content
      .map((c) => (c.type === "text" ? (c.text ?? "") : `[${c.type} content]`))
      .join("\n");
    return { ok: !r.isError, text };
  }
}
