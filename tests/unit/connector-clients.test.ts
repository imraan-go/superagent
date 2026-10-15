import { describe, expect, it } from "vitest";
import { McpClient, parseRpcBody } from "@/server/connectors/mcp-client";

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

const jsonRes = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });

describe("MCP streamable HTTP client", () => {
  it("initializes, carries the session id and lists tools", async () => {
    const { fn, calls } = mockFetch([
      () => jsonRes({ jsonrpc: "2.0", id: 1, result: { serverInfo: { name: "srv" } } }, { "mcp-session-id": "s-1" }),
      () => new Response(null, { status: 202 }),
      () =>
        new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 2, result: { tools: [{ name: "search" }] } })}\n\n`, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    ]);
    const client = new McpClient("https://mcp.example/mcp", "tok", fn);
    const tools = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["search"]);

    const first = JSON.parse(String(calls[0]!.init.body));
    expect(first).toMatchObject({ jsonrpc: "2.0", id: 1, method: "initialize" });
    const h0 = calls[0]!.init.headers as Record<string, string>;
    expect(h0.authorization).toBe("Bearer tok");
    expect(h0.accept).toContain("text/event-stream");
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect((calls[2]!.init.headers as Record<string, string>)["mcp-session-id"]).toBe("s-1");
    expect(JSON.parse(String(calls[2]!.init.body)).method).toBe("tools/list");
  });

  it("calls a tool and maps isError", async () => {
    const { fn, calls } = mockFetch([
      () => jsonRes({ jsonrpc: "2.0", id: 1, result: {} }),
      () => new Response(null, { status: 202 }),
      () => jsonRes({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: "boom" }], isError: true } }),
    ]);
    const out = await new McpClient("https://m/mcp", null, fn).callTool("x", { a: 1 });
    expect(out).toEqual({ ok: false, text: "boom" });
    expect(JSON.parse(String(calls[2]!.init.body)).params).toEqual({ name: "x", arguments: { a: 1 } });
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it("raises JSON-RPC errors", () => {
    expect(parseRpcBody(JSON.stringify({ jsonrpc: "2.0", id: 3, error: { code: -1, message: "bad" } }), "application/json", 3).error?.message).toBe("bad");
    expect(() => parseRpcBody("{}", "application/json", 9)).toThrow();
  });
});

describe("MCP client session reuse", () => {
  const init = (id: number, sid: string) => () =>
    jsonRes({ jsonrpc: "2.0", id, result: { serverInfo: { name: "srv" } } }, { "mcp-session-id": sid });
  const ack = () => new Response(null, { status: 202 });
  const text = (id: number, t: string) => () => jsonRes({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: t }] } });
  const methods = (calls: Call[]) => calls.map((c) => JSON.parse(String(c.init.body)).method as string);

  it("handshakes once and reuses the session for later calls", async () => {
    const { fn, calls } = mockFetch([init(1, "s-1"), ack, text(2, "a"), text(3, "b")]);
    const client = new McpClient("https://m/mcp", null, fn);
    expect((await client.callTool("x", {})).text).toBe("a");
    expect((await client.callTool("x", {})).text).toBe("b");
    expect(methods(calls)).toEqual(["initialize", "notifications/initialized", "tools/call", "tools/call"]);
    expect((calls[3]!.init.headers as Record<string, string>)["mcp-session-id"]).toBe("s-1");
  });

  it("shares one handshake between concurrent calls", async () => {
    const { fn, calls } = mockFetch([
      init(1, "s-1"),
      ack,
      () => jsonRes([
        { jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: "a" }] } },
        { jsonrpc: "2.0", id: 3, result: { content: [{ type: "text", text: "b" }] } },
      ]),
    ]);
    const client = new McpClient("https://m/mcp", null, fn);
    await Promise.all([client.callTool("x", {}), client.callTool("y", {})]);
    expect(methods(calls).filter((m) => m === "initialize")).toHaveLength(1);
  });

  it("re-initializes and retries once when the server drops the session", async () => {
    const { fn, calls } = mockFetch([
      init(1, "s-1"),
      ack,
      text(2, "a"),
      () => new Response("", { status: 404 }),
      init(4, "s-2"),
      ack,
      text(5, "b"),
    ]);
    const client = new McpClient("https://m/mcp", null, fn);
    await client.callTool("x", {});
    expect((await client.callTool("x", {})).text).toBe("b");
    expect(methods(calls)).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/call",
      "tools/call",
      "initialize",
      "notifications/initialized",
      "tools/call",
    ]);
    expect((calls[6]!.init.headers as Record<string, string>)["mcp-session-id"]).toBe("s-2");
  });

  it("does not cache a failed handshake", async () => {
    const { fn } = mockFetch([() => new Response("", { status: 503 }), init(2, "s-1"), ack, text(3, "ok")]);
    const client = new McpClient("https://m/mcp", null, fn);
    await expect(client.callTool("x", {})).rejects.toThrow("HTTP 503");
    expect((await client.callTool("x", {})).text).toBe("ok");
  });

  it("aborts an in-flight call when the caller's signal fires", async () => {
    const ctl = new AbortController();
    let n = 0;
    const fn = async (_url: string, req?: RequestInit) => {
      n += 1;
      if (n === 1) return init(1, "s-1")();
      if (n === 2) return ack();
      return new Promise<Response>((_, reject) => req?.signal?.addEventListener("abort", () => reject(req.signal!.reason)));
    };
    const client = new McpClient("https://m/mcp", null, fn);
    const p = client.callTool("x", {}, { signal: ctl.signal });
    setTimeout(() => ctl.abort(), 10);
    await expect(p).rejects.toBeDefined();
  });
});
