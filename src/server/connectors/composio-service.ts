import "server-only";
import { env } from "@/server/env";
import { createWebhook, deleteWebhook } from "@/server/automation/webhooks";
import { AppError } from "@/server/lib/errors";
import { ComposioClient } from "./composio-client";
import { getComposioConfig, sealSecret, updateComposioConfig } from "./composio-config";
import { selectedActions } from "./composio-schema";
import { getToolkitTools } from "./composio-tools";
import { addMcpServer, deleteMcpServer, listMcpServers } from "./store";

/** Public inbound URL Composio delivers trigger events to. */
export function composioWebhookUrl(): string {
  return `${env.APP_URL.replace(/\/$/, "")}/api/webhooks/composio`;
}

const CREDENTIAL_SCHEMES = ["API_KEY", "BEARER_TOKEN", "BASIC"] as const;
type CredentialScheme = (typeof CREDENTIAL_SCHEMES)[number];

export type ConnectResult =
  | { kind: "redirect"; redirectUrl: string; accountId: string }
  | { kind: "connected"; accountId: string }
  | { kind: "needs_credentials"; scheme: CredentialScheme; fields: Array<{ name: string; displayName: string; required: boolean; secret: boolean }> }
  | { kind: "unsupported"; reason: string; guideUrl: string | null };

/**
 * Starts a connection for the owner. Preference order: Composio-managed OAuth
 * (hosted Connect Link) -> credential schemes (the form posts values straight
 * to Composio; nothing is stored or echoed here) -> unsupported (needs the
 * owner's own developer app; link to Composio's guide).
 */
export async function connectToolkit(
  client: ComposioClient,
  toolkit: string,
  opts: { callbackUrl: string; credentials?: Record<string, string> | undefined },
): Promise<ConnectResult> {
  const tk = await client.getToolkit(toolkit);

  if (tk.composioManagedAuthSchemes.length > 0 && !opts.credentials) {
    const cfg = await client.ensureAuthConfig(toolkit, "managed");
    const link = await client.createConnectLink(cfg.id, opts.callbackUrl);
    return { kind: "redirect", ...link };
  }

  const detail = tk.authConfigDetails.find((d) => (CREDENTIAL_SCHEMES as readonly string[]).includes(d.mode));
  if (detail) {
    const scheme = detail.mode as CredentialScheme;
    if (!opts.credentials) return { kind: "needs_credentials", scheme, fields: detail.initiationFields };
    const missing = detail.initiationFields.filter((f) => f.required && !opts.credentials![f.name]?.trim());
    if (missing.length > 0) throw new AppError("bad_request", `Missing: ${missing.map((m) => m.displayName).join(", ")}.`);
    const allowed = new Set(detail.initiationFields.map((f) => f.name));
    const clean = Object.fromEntries(Object.entries(opts.credentials).filter(([k, v]) => allowed.has(k) && v.trim()));
    const cfg = await client.ensureAuthConfig(toolkit, { scheme });
    const acc = await client.createCredentialAccount(cfg.id, scheme, clean);
    return { kind: "connected", accountId: acc.id };
  }

  if (tk.composioManagedAuthSchemes.length > 0) {
    // Managed OAuth exists but the caller sent credentials: ignore them, use OAuth.
    const cfg = await client.ensureAuthConfig(toolkit, "managed");
    const link = await client.createConnectLink(cfg.id, opts.callbackUrl);
    return { kind: "redirect", ...link };
  }
  return {
    kind: "unsupported",
    reason: "Composio does not host an OAuth app for this toolkit. Create your own developer app and an auth config in the Composio dashboard first.",
    guideUrl: tk.authGuideUrl,
  };
}

/* ------------------------------------------------------------------ mcp -- */

export const COMPOSIO_MCP_NAME = "composio";

/**
 * Creates (or refreshes) a Composio-hosted MCP server limited to the owner's
 * connected toolkits and ENABLED tools, then registers it in the panel's
 * remote-MCP list DISABLED: the direct-execution path stays the default and
 * running both would offer every tool twice.
 */
export async function ensureComposioMcp(client: ComposioClient): Promise<{ url: string; serverId: string; allowedTools: number; toolkits: string[] }> {
  const accounts = (await client.listConnectedAccounts()).filter((a) => (a.status ?? "").toUpperCase() === "ACTIVE");
  const authConfigIds = [...new Set(accounts.map((a) => a.auth_config?.id).filter((x): x is string => Boolean(x)))];
  const toolkits = [...new Set(accounts.map((a) => a.toolkit?.slug).filter((x): x is string => Boolean(x)))];
  if (authConfigIds.length === 0) throw new AppError("bad_request", "Connect at least one app first.");

  const cfg = await getComposioConfig();
  const allowed: string[] = [];
  for (const tk of toolkits) {
    const { rows } = await getToolkitTools(client, tk);
    allowed.push(...selectedActions(rows, cfg.tools[tk]).map((r) => r.slug));
  }

  let serverId = cfg.mcp?.serverId;
  if (serverId) {
    try {
      await client.updateMcpServer(serverId, { authConfigIds, allowedTools: allowed });
    } catch {
      serverId = undefined; // deleted upstream: recreate
    }
  }
  if (!serverId) {
    const created = await client.createMcpServer({
      name: `panel-${Date.now().toString(36)}`,
      authConfigIds,
      allowedTools: allowed,
    });
    serverId = created.id;
  }
  const url = await client.generateMcpUrl(serverId);

  const existing = (await listMcpServers()).find((s) => s.name === COMPOSIO_MCP_NAME);
  if (existing) await deleteMcpServer(existing.id);
  const panel = await addMcpServer({ name: COMPOSIO_MCP_NAME, url, composio: true, enabled: false });
  await updateComposioConfig((c) => ({ ...c, mcp: { serverId: serverId!, name: COMPOSIO_MCP_NAME, panelServerId: panel.id } }));
  return { url, serverId, allowedTools: allowed.length, toolkits };
}

export async function removeComposioMcp(client: ComposioClient): Promise<void> {
  const cfg = await getComposioConfig();
  if (cfg.mcp) await client.deleteMcpServer(cfg.mcp.serverId).catch(() => undefined);
  const existing = (await listMcpServers()).find((s) => s.name === COMPOSIO_MCP_NAME);
  if (existing) await deleteMcpServer(existing.id);
  await updateComposioConfig((c) => ({ ...c, mcp: null }));
}

/* ------------------------------------------------------------- triggers -- */

async function ensureSubscription(client: ComposioClient): Promise<void> {
  const cfg = await getComposioConfig();
  if (cfg.subscription) return;
  const url = composioWebhookUrl();
  // Composio allows one subscription per project; drop a stale one we no longer hold the secret for.
  for (const sub of await client.listWebhookSubscriptions()) {
    if (sub.webhook_url === url) await client.deleteWebhookSubscription(sub.id);
  }
  const sub = await client.createWebhookSubscription(url);
  await updateComposioConfig((c) => ({ ...c, subscription: { id: sub.id, secretEnc: sealSecret(sub.secret) } }));
}

/**
 * Enables a trigger: creates the Composio trigger instance for the owner's
 * connected account and a panel webhook (prompt target). Deliveries arrive at
 * /api/webhooks/composio, are verified, and then fire that webhook, which runs
 * under the same unattended-run budget guard as every other webhook.
 */
export async function enableTrigger(
  client: ComposioClient,
  input: { slug: string; toolkit: string; connectedAccountId: string; prompt: string; config?: Record<string, unknown> | undefined },
): Promise<{ triggerId: string; webhookId: string }> {
  await ensureSubscription(client);
  const { webhook } = await createWebhook({ kind: "prompt", name: `composio:${input.slug}`.slice(0, 80), prompt: input.prompt });
  try {
    const triggerId = await client.upsertTrigger(input.slug, input.connectedAccountId, input.config ?? {});
    await updateComposioConfig((c) => ({
      ...c,
      triggers: [
        ...c.triggers.filter((t) => t.triggerId !== triggerId),
        { triggerId, slug: input.slug, toolkit: input.toolkit, webhookId: webhook.id, prompt: input.prompt },
      ],
    }));
    return { triggerId, webhookId: webhook.id };
  } catch (err) {
    await deleteWebhook(webhook.id).catch(() => undefined);
    throw err;
  }
}

export async function disableTrigger(client: ComposioClient, triggerId: string): Promise<void> {
  const cfg = await getComposioConfig();
  const t = cfg.triggers.find((x) => x.triggerId === triggerId);
  await client.deleteTrigger(triggerId);
  if (t) await deleteWebhook(t.webhookId).catch(() => undefined);
  await updateComposioConfig((c) => ({ ...c, triggers: c.triggers.filter((x) => x.triggerId !== triggerId) }));
}
