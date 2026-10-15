import "server-only";
import { sanitizeSchema, sanitizeToolDescription } from "@/server/agent/guard";
import { AppError } from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";
import { assertPublicUrl } from "@/server/lib/ssrf";
import type { AdapterTool } from "@/server/models/types";
import { ComposioClient } from "./composio-client";
import { getComposioConfig } from "./composio-config";
import { applyBudget, selectedActions } from "./composio-schema";
import type { ToolRow } from "./composio-schema";
import { getToolkitTools } from "./composio-tools";
import { enforceRateLimit } from "@/server/lib/rate";
import { McpClient } from "./mcp-client";
import { PIPEDREAM_EMIT } from "./external-approval";
import { isExternalToolName, namespacedTool } from "./naming";
import { getComposioKey, getPipedream, listMcpServers, mcpCredentials } from "./store";

/**
 * Non-LHOS tools for the agent loop: Composio actions, remote MCP tools and
 * `pipedream__emit`. All executed server-side; credentials never reach the
 * model. Results are external data and are returned as tool *results* only.
 *
 * Cached process-locally for 5 minutes (ADR-04 single instance).
 */
const TTL_MS = 5 * 60 * 1000;
const PER_SOURCE_TIMEOUT_MS = 8_000;

type Route =
  | { kind: "composio"; slug: string }
  | { kind: "mcp"; serverId: string; tool: string; readOnly: boolean }
  | { kind: "pipedream" };

interface Cache {
  tools: AdapterTool[];
  routes: Map<string, Route>;
  at: number;
}

/**
 * One live MCP client per server, so its session is reused across calls
 * (one round trip per tool call instead of initialize + notify + call).
 * Keyed by server id; `key` fingerprints the credentials so a changed URL,
 * token or header gets a fresh client. Credentials and the public-URL check
 * are resolved when a client is created, i.e. at most once per cache build.
 */
interface PooledMcp {
  key: string;
  client: McpClient;
}

const g = globalThis as unknown as { __fdExtTools?: Cache; __fdMcpPool?: Map<string, PooledMcp> };

function mcpPool(): Map<string, PooledMcp> {
  return (g.__fdMcpPool ??= new Map());
}

export function invalidateExternalTools(): void {
  g.__fdExtTools = undefined;
  // Dropped, not closed: a run may still be mid-call on one of these sessions.
  g.__fdMcpPool = undefined;
}

/** The pooled client for a server, (re)created when its credentials change. */
async function mcpClientFor(serverId: string): Promise<McpClient | null> {
  const cred = await mcpCredentials(serverId);
  if (!cred) {
    mcpPool().delete(serverId);
    return null;
  }
  const key = JSON.stringify([cred.url, cred.bearer, cred.headers]);
  const pooled = mcpPool().get(serverId);
  if (pooled?.key === key) return pooled.client;
  const client = new McpClient(cred.url, cred.bearer, fetch, 30_000, cred.headers);
  mcpPool().set(serverId, { key, client });
  return client;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timed out")), ms)),
  ]);
}

async function build(): Promise<Cache> {
  const tools: AdapterTool[] = [];
  const routes = new Map<string, Route>();
  const add = (tool: AdapterTool, route: Route) => {
    if (routes.has(tool.name)) return; // clipped-name collision: first wins
    routes.set(tool.name, route);
    tools.push(tool);
  };

  const sources: Array<Promise<void>> = [];

  sources.push(
    (async () => {
      const key = await getComposioKey();
      if (!key) return;
      const client = new ComposioClient(key.key);
      const accounts = await client.listConnectedAccounts();
      const toolkits = [
        ...new Set(
          accounts
            .filter((a) => (a.status ?? "").toUpperCase() === "ACTIVE")
            .map((a) => a.toolkit?.slug)
            .filter((s): s is string => Boolean(s)),
        ),
      ];
      const cfg = await getComposioConfig();
      const candidates: Array<ToolRow & { toolkit: string; schema: unknown }> = [];
      await Promise.all(
        toolkits.map(async (tk) => {
          try {
            const { rows, schemas } = await getToolkitTools(client, tk);
            for (const r of selectedActions(rows, cfg.tools[tk])) candidates.push({ ...r, toolkit: tk, schema: schemas.get(r.slug) });
          } catch (err) {
            logger.warn("connectors", { msg: "composio tools unavailable", toolkit: tk, detail: String(err) });
          }
        }),
      );
      const { kept, dropped } = applyBudget(candidates);
      if (dropped > 0) logger.warn("connectors", { msg: "composio schema budget exceeded", dropped });
      for (const t of kept) {
        add(
          {
            name: namespacedTool("composio", t.toolkit, t.action),
            description: `[Composio · ${t.toolkit}] ${sanitizeToolDescription(t.description || t.name, 240)}`,
            inputSchema: (sanitizeSchema(t.schema) as AdapterTool["inputSchema"] | undefined) ?? { type: "object", properties: {} },
          },
          { kind: "composio", slug: t.slug },
        );
      }
    })(),
  );

  sources.push(
    (async () => {
      const servers = (await listMcpServers()).filter((s) => s.enabled);
      // Fetched concurrently so one slow server cannot starve the rest of the
      // source budget; added in list order so name collisions stay deterministic.
      const listed = await Promise.all(
        servers.map(async (server) => {
          try {
            const client = await mcpClientFor(server.id);
            if (!client) return [];
            // The race also bounds the handshake, which runs on the client's own timeout.
            return await withTimeout(client.listTools({ signal: AbortSignal.timeout(PER_SOURCE_TIMEOUT_MS) }), PER_SOURCE_TIMEOUT_MS);
          } catch (err) {
            logger.warn("connectors", { msg: "mcp tools unavailable", server: server.name, detail: String(err) });
            return [];
          }
        }),
      );
      for (const [i, server] of servers.entries()) {
        for (const t of listed[i]!) {
          add(
            {
              name: namespacedTool("mcp", server.name, t.name),
              description: `[MCP · ${server.name}] ${sanitizeToolDescription(t.description ?? t.name)}`,
              inputSchema: (sanitizeSchema(t.inputSchema) as AdapterTool["inputSchema"] | undefined) ?? { type: "object", properties: {} },
            },
            { kind: "mcp", serverId: server.id, tool: t.name, readOnly: t.annotations?.readOnlyHint === true },
          );
        }
      }
    })(),
  );

  sources.push(
    (async () => {
      if (!(await getPipedream())) return;
      add(
        {
          name: PIPEDREAM_EMIT,
          description:
            "Send a JSON event to the owner's Pipedream source (triggers their Pipedream workflow). Requires owner approval.",
          inputSchema: {
            type: "object",
            properties: { event: { type: "object", description: "JSON payload to emit", additionalProperties: true } },
            required: ["event"],
          },
        },
        { kind: "pipedream" },
      );
    })(),
  );

  const settled = await Promise.allSettled(sources.map((s) => withTimeout(s, PER_SOURCE_TIMEOUT_MS * 2)));
  for (const s of settled) {
    if (s.status === "rejected") logger.warn("connectors", { msg: "external tool source failed", detail: String(s.reason) });
  }
  return { tools, routes, at: Date.now() };
}

export async function listExternalTools(options?: { force?: boolean }): Promise<AdapterTool[]> {
  const c = g.__fdExtTools;
  if (!options?.force && c && Date.now() - c.at < TTL_MS) return c.tools;
  g.__fdExtTools = await build();
  return g.__fdExtTools.tools;
}

export { isExternalToolName };

export { externalApproval, PIPEDREAM_EMIT } from "./external-approval";

export async function executeExternalTool(
  name: string,
  args: Record<string, unknown>,
  opts: { signal?: AbortSignal } = {},
): Promise<{ ok: boolean; text: string; ms: number }> {
  const started = Date.now();
  if (!g.__fdExtTools?.routes.has(name)) await listExternalTools({ force: true });
  const route = g.__fdExtTools?.routes.get(name);
  if (!route) throw new AppError("not_found", `Tool ${name} is not connected.`);

  switch (route.kind) {
    case "composio": {
      const key = await getComposioKey();
      if (!key) throw new AppError("bad_request", "Composio is not configured.");
      enforceRateLimit("composioExecute");
      const out = await new ComposioClient(key.key).executeTool(route.slug, args);
      const rec = out as { successful?: boolean; error?: unknown; data?: unknown };
      return {
        ok: rec.successful !== false && !rec.error,
        text: (typeof rec.error === "string" && rec.error ? `Composio error: ${rec.error}` : JSON.stringify(rec.data ?? out)).slice(0, 24_000),
        ms: Date.now() - started,
      };
    }
    case "mcp": {
      // The pool is filled by the cache build and emptied on any connector change.
      const client = mcpPool().get(route.serverId)?.client ?? (await mcpClientFor(route.serverId));
      if (!client) throw new AppError("not_found", "That MCP server was removed.");
      const res = await client.callTool(route.tool, args, { signal: opts.signal, timeoutMs: 120_000 });
      return { ...res, ms: Date.now() - started };
    }
    case "pipedream": {
      const pd = await getPipedream();
      if (!pd) throw new AppError("bad_request", "No Pipedream source URL is configured.");
      await assertPublicUrl(pd.url, { requireHttps: true });
      const res = await fetch(pd.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args.event ?? args),
        signal: opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
        redirect: "error",
      });
      const body = (await res.text()).slice(0, 2000);
      return { ok: res.ok, text: `HTTP ${res.status} from ${pd.host}${body ? `: ${body}` : ""}`, ms: Date.now() - started };
    }
  }
}
