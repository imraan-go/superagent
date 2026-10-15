import { describe, expect, it } from "vitest";
import { COMPOSIO_BASE, ComposioClient } from "@/server/connectors/composio-client";
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

describe("Composio client request shaping", () => {
  it("sends x-api-key and lists connected accounts for the owner", async () => {
    const { fn, calls } = mockFetch([() => jsonRes({ items: [{ id: "ca_1", status: "ACTIVE", toolkit: { slug: "gmail" } }] })]);
    const accounts = await new ComposioClient("ck_test", fn).listConnectedAccounts();
    expect(accounts[0]?.toolkit?.slug).toBe("gmail");
    expect(calls[0]!.url.startsWith(`${COMPOSIO_BASE}/connected_accounts?user_ids=owner`)).toBe(true);
    expect((calls[0]!.init.headers as Record<string, string>)["x-api-key"]).toBe("ck_test");
  });

  it("connect creates an auth config then a connected account", async () => {
    const { fn, calls } = mockFetch([
      () => jsonRes({ auth_config: { id: "ac_1" } }),
      () => jsonRes({ id: "ca_2", redirect_url: "https://connect.example/x" }),
    ]);
    const res = await new ComposioClient("k", fn).connect("notion", "https://panel.example/");
    expect(res).toEqual({ id: "ca_2", redirectUrl: "https://connect.example/x" });
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ toolkit: { slug: "notion" } });
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({
      auth_config: { id: "ac_1" },
      connection: { user_id: "owner", callback_url: "https://panel.example/" },
    });
  });

  it("executes a tool with user_id + arguments and surfaces HTTP errors", async () => {
    const { fn, calls } = mockFetch([() => jsonRes({ successful: true, data: { ok: 1 } })]);
    await new ComposioClient("k", fn).executeTool("GMAIL_SEND_EMAIL", { to: "a@b.c" });
    expect(calls[0]!.url).toBe(`${COMPOSIO_BASE}/tools/execute/GMAIL_SEND_EMAIL`);
    expect(calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ user_id: "owner", arguments: { to: "a@b.c" } });

    const bad = mockFetch([() => new Response("nope", { status: 401 })]);
    await expect(new ComposioClient("k", bad.fn).listToolkits()).rejects.toThrow(/401/);
  });
});

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
