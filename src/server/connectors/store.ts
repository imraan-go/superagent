import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { connectors, secrets } from "@/server/db/schema";
import { env } from "@/server/env";
import { last4, seal, unseal } from "@/server/lib/crypto";
import { AppError } from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";
import { assertPublicUrl } from "@/server/lib/ssrf";

/**
 * Persistence for connector configuration. No migrations in Phase 4, so:
 *  - Composio key   → `secrets` row named `composio` (sealed), env fallback.
 *  - Pipedream      → `connectors` kind=pipedream, config.urlEnc (sealed URL).
 *  - Remote MCP     → `connectors` kind=custom, config.type="mcp",
 *                     config.url, config.bearerEnc (sealed, optional).
 * Custom REST connectors live in the LHOS vault (connector_save), not here.
 */
export const COMPOSIO_SECRET = "composio";

async function readSecret(name: string): Promise<string | null> {
  const [row] = await db.select({ enc: secrets.enc }).from(secrets).where(eq(secrets.name, name)).limit(1);
  if (!row) return null;
  try {
    return unseal(row.enc);
  } catch {
    logger.error("connectors", { msg: "stored secret failed to decrypt", name });
    return null;
  }
}

export async function getComposioKey(): Promise<{ key: string; source: "settings" | "env" } | null> {
  const stored = await readSecret(COMPOSIO_SECRET);
  if (stored) return { key: stored, source: "settings" };
  return env.COMPOSIO_API_KEY ? { key: env.COMPOSIO_API_KEY, source: "env" } : null;
}

export async function setComposioKey(value: string): Promise<{ last4: string }> {
  const enc = seal(value);
  const l4 = last4(value);
  await db
    .insert(secrets)
    .values({ name: COMPOSIO_SECRET, enc, last4: l4, vendor: "composio" })
    .onConflictDoUpdate({ target: secrets.name, set: { enc, last4: l4, updatedAt: new Date() } });
  return { last4: l4 };
}

export async function deleteComposioKey(): Promise<void> {
  await db.delete(secrets).where(eq(secrets.name, COMPOSIO_SECRET));
}

export async function composioKeyLast4(): Promise<string | null> {
  const [row] = await db
    .select({ last4: secrets.last4 })
    .from(secrets)
    .where(eq(secrets.name, COMPOSIO_SECRET))
    .limit(1);
  return row?.last4 ?? null;
}

/* ------------------------------------------------------------ pipedream -- */

const pipedreamConfig = z.object({ urlEnc: z.string(), urlHost: z.string() });

export async function getPipedream(): Promise<{ id: string; url: string; host: string } | null> {
  const [row] = await db.select().from(connectors).where(eq(connectors.kind, "pipedream")).limit(1);
  if (!row || !row.enabled) return null;
  const cfg = pipedreamConfig.safeParse(row.config);
  if (!cfg.success) return null;
  try {
    return { id: row.id, url: unseal(cfg.data.urlEnc), host: cfg.data.urlHost };
  } catch {
    return null;
  }
}

export async function setPipedreamSource(url: string | null): Promise<void> {
  await db.delete(connectors).where(eq(connectors.kind, "pipedream"));
  if (!url) return;
  await db.insert(connectors).values({
    kind: "pipedream",
    name: "pipedream",
    config: { urlEnc: seal(url), urlHost: new URL(url).host },
  });
}

/* ------------------------------------------------------------------ mcp -- */

const mcpConfig = z.object({
  type: z.literal("mcp"),
  url: z.url(),
  bearerEnc: z.string().nullable().optional(),
});

export interface McpServer {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  hasBearer: boolean;
  builtin: boolean;
}

export const LHOS_MCP_ID = "lhos";

/** The LHOS MCP endpoint itself, read-only and not exposed to the loop (its tools already are, via REST). */
export function builtinLhosServer(): McpServer {
  return {
    id: LHOS_MCP_ID,
    name: "lhos",
    url: `${env.LHOS_BASE_URL.replace(/\/$/, "")}/mcp`,
    enabled: true,
    hasBearer: true,
    builtin: true,
  };
}

const isMcp = sql`${connectors.config}->>'type' = 'mcp'`;

export async function listMcpServers(): Promise<McpServer[]> {
  const rows = await db.select().from(connectors).where(and(eq(connectors.kind, "custom"), isMcp));
  return rows.flatMap((r) => {
    const cfg = mcpConfig.safeParse(r.config);
    if (!cfg.success) return [];
    return [{ id: r.id, name: r.name, url: cfg.data.url, enabled: r.enabled, hasBearer: Boolean(cfg.data.bearerEnc), builtin: false }];
  });
}

export async function addMcpServer(input: { name: string; url: string; bearer?: string | undefined }): Promise<McpServer> {
  const existing = await listMcpServers();
  if (existing.some((s) => s.name === input.name) || input.name === LHOS_MCP_ID) {
    throw new AppError("conflict", `An MCP server named "${input.name}" already exists.`);
  }
  const [row] = await db
    .insert(connectors)
    .values({
      kind: "custom",
      name: input.name,
      config: { type: "mcp", url: input.url, bearerEnc: input.bearer ? seal(input.bearer) : null },
    })
    .returning();
  if (!row) throw new AppError("internal", "Could not save the MCP server.");
  return { id: row.id, name: row.name, url: input.url, enabled: true, hasBearer: Boolean(input.bearer), builtin: false };
}

export async function setMcpEnabled(id: string, enabled: boolean): Promise<void> {
  await db.update(connectors).set({ enabled }).where(and(eq(connectors.id, id), isMcp));
}

export async function deleteMcpServer(id: string): Promise<void> {
  await db.delete(connectors).where(and(eq(connectors.id, id), eq(connectors.kind, "custom"), isMcp));
}

/** Resolves URL + bearer for connecting. Never returned to a client. */
export async function mcpCredentials(id: string): Promise<{ name: string; url: string; bearer: string | null } | null> {
  if (id === LHOS_MCP_ID) {
    return { name: "lhos", url: builtinLhosServer().url, bearer: env.LHOS_MCP_TOKEN };
  }
  if (!z.uuid().safeParse(id).success) return null;
  const [row] = await db.select().from(connectors).where(and(eq(connectors.id, id), isMcp)).limit(1);
  const cfg = mcpConfig.safeParse(row?.config);
  if (!row || !cfg.success) return null;
  let bearer: string | null = null;
  if (cfg.data.bearerEnc) {
    try {
      bearer = unseal(cfg.data.bearerEnc);
    } catch {
      logger.error("connectors", { msg: "mcp bearer failed to decrypt", id });
    }
  }
  // Re-checked at connect time (DNS may have changed since it was saved): an
  // owner-entered MCP URL must never reach loopback/private hosts such as the
  // Manage bridge on 127.0.0.1:7071.
  await assertPublicUrl(cfg.data.url, { allowOrigins: [env.LHOS_BASE_URL] });
  return { name: row.name, url: cfg.data.url, bearer };
}

/** Validates an owner-entered outbound URL before it is saved or fetched. */
export async function assertSafeConnectorUrl(url: string, opts: { requireHttps?: boolean } = {}): Promise<void> {
  await assertPublicUrl(url, { allowOrigins: [env.LHOS_BASE_URL], ...opts });
}
