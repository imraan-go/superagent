import "server-only";
import { requiresApproval } from "@/server/agent/policy";
import type { ApprovalDecision } from "@/server/agent/policy";
import { sanitizeSchema, sanitizeToolDescription } from "@/server/agent/guard";
import { AppError } from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";
import { assertPublicUrl } from "@/server/lib/ssrf";
import type { AdapterTool } from "@/server/models/types";
import { ComposioClient } from "./composio-client";
import { McpClient } from "./mcp-client";
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

const g = globalThis as unknown as { __fdExtTools?: Cache };

export const PIPEDREAM_EMIT = "pipedream__emit";

export function invalidateExternalTools(): void {
  g.__fdExtTools = undefined;
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
            .filter((a) => (a.status ?? "ACTIVE").toUpperCase() === "ACTIVE")
            .map((a) => a.toolkit?.slug)
            .filter((s): s is string => Boolean(s)),
        ),
      ];
      for (const tk of toolkits) {
        for (const t of await client.listTools(tk)) {
          add(
            {
              name: namespacedTool("composio", tk, t.slug.replace(new RegExp(`^${tk}_`, "i"), "")),
              description: `[Composio · ${tk}] ${sanitizeToolDescription(t.description ?? t.name ?? t.slug)}`,
              inputSchema: (sanitizeSchema(t.input_parameters) as AdapterTool["inputSchema"] | undefined) ?? { type: "object", properties: {} },
            },
            { kind: "composio", slug: t.slug },
          );
        }
      }
    })(),
  );

  sources.push(
    (async () => {
      for (const server of (await listMcpServers()).filter((s) => s.enabled)) {
        const cred = await mcpCredentials(server.id);
        if (!cred) continue;
        try {
          const client = new McpClient(cred.url, cred.bearer);
          for (const t of await withTimeout(client.listTools(), PER_SOURCE_TIMEOUT_MS)) {
            add(
              {
                name: namespacedTool("mcp", server.name, t.name),
                description: `[MCP · ${server.name}] ${sanitizeToolDescription(t.description ?? t.name)}`,
                inputSchema: (sanitizeSchema(t.inputSchema) as AdapterTool["inputSchema"] | undefined) ?? { type: "object", properties: {} },
              },
              { kind: "mcp", serverId: server.id, tool: t.name, readOnly: t.annotations?.readOnlyHint === true },
            );
          }
        } catch (err) {
          logger.warn("connectors", { msg: "mcp tools unavailable", server: server.name, detail: String(err) });
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

/**
 * Approval decision for external tools: the default policy (send/post/delete…)
 * plus `pipedream__emit`, which always leaves the box.
 */
export function externalApproval(
  name: string,
  opts: { extraPatterns?: readonly string[]; args?: Record<string, unknown> } = {},
): ApprovalDecision {
  const base = requiresApproval(name, { extraPatterns: opts.extraPatterns ?? [] }, opts.args);
  if (base.required) return base;
  if (name === PIPEDREAM_EMIT) return { required: true, reason: "emits an event to an external system" };
  return base;
}

export async function executeExternalTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; text: string; ms: number }> {
  const started = Date.now();
  if (!g.__fdExtTools?.routes.has(name)) await listExternalTools({ force: true });
  const route = g.__fdExtTools?.routes.get(name);
  if (!route) throw new AppError("not_found", `Tool ${name} is not connected.`);

  switch (route.kind) {
    case "composio": {
      const key = await getComposioKey();
      if (!key) throw new AppError("bad_request", "Composio is not configured.");
      const out = await new ComposioClient(key.key).executeTool(route.slug, args);
      const rec = out as { successful?: boolean; error?: unknown; data?: unknown };
      return {
        ok: rec.successful !== false && !rec.error,
        text: JSON.stringify(rec.data ?? out),
        ms: Date.now() - started,
      };
    }
    case "mcp": {
      const cred = await mcpCredentials(route.serverId);
      if (!cred) throw new AppError("not_found", "That MCP server was removed.");
      const res = await new McpClient(cred.url, cred.bearer, fetch, 120_000).callTool(route.tool, args);
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
        signal: AbortSignal.timeout(30_000),
        redirect: "error",
      });
      const body = (await res.text()).slice(0, 2000);
      return { ok: res.ok, text: `HTTP ${res.status} from ${pd.host}${body ? `: ${body}` : ""}`, ms: Date.now() - started };
    }
  }
}
