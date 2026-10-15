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
