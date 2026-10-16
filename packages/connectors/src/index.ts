import { Composio } from '@composio/core';
import { composioAuthConfigs, getEnv, requireKeys } from '@superagent/config';
import type { ConnectorToolkit } from '@superagent/contracts';
import { CONNECTOR_CANDIDATES, CONNECTOR_LOCK } from '@superagent/policy';

export type Toolkit = ConnectorToolkit;
export type ConnectionState = 'initiated' | 'active' | 'expired' | 'revoked' | 'failed' | 'disconnected';

export interface VerifiedConnection {
  state: ConnectionState;
  statusReason: string | null;
  toolkit: string | null;
  authConfigId: string | null;
}

export interface ExecuteResult {
  ok: boolean;
  data: unknown;
  error: string | null;
  logId: string | null;
}

function mapStatus(s: string | undefined): ConnectionState {
  switch (s) {
    case 'ACTIVE':
      return 'active';
    case 'EXPIRED':
      return 'expired';
    case 'REVOKED':
      return 'revoked';
    case 'FAILED':
      return 'failed';
    case 'INACTIVE':
      return 'disconnected';
    default:
      return 'initiated';
  }
}

/** Account ids the session reports for a toolkit, or null when the response does not echo them. */
function boundAccounts(config: unknown, toolkit: string): string[] | null {
  if (!config || typeof config !== 'object') return null;
  const record = config as Record<string, unknown>;
  const map = record.connectedAccounts ?? record.connected_accounts;
  if (!map || typeof map !== 'object') return null;
  const value = (map as Record<string, unknown>)[toolkit];
  if (value === undefined) return null;
  const ids = Array.isArray(value) ? value : [value];
  return ids.filter((id): id is string => typeof id === 'string');
}

function toolkitVersionsFromLock(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of Object.values(CONNECTOR_LOCK)) out[e.toolkit] = e.version;
  return out;
}

/**
 * Composio adapter using sessions only (no legacy direct tool execution, no meta-tools handed to the
 * model). Every session is created for the server-derived Composio user id of the authenticated
 * owner and, for execution, pinned to that owner's verified connected account.
 */
export class ComposioConnector {
  private readonly composio: Composio;

  constructor(apiKey: string, toolkitVersions = toolkitVersionsFromLock()) {
    this.composio = new Composio({ apiKey, allowTracking: false, toolkitVersions, logLevel: 'warn' });
  }

  /** Starts a Connect Link / OAuth flow. The returned redirectUrl is opened by the user in their browser. */
  async initiate(composioUserId: string, toolkit: Toolkit, callbackUrl: string): Promise<{ redirectUrl: string; connectedAccountId: string }> {
    const authConfigs = composioAuthConfigs();
    const session = await this.composio.sessions.create(composioUserId, {
      sessionPreset: 'direct_tools',
      toolkits: [toolkit],
      ...(authConfigs[toolkit] ? { authConfigs: { [toolkit]: authConfigs[toolkit]! } } : {}),
      manageConnections: false,
      sandbox: { enable: false },
    });
    const req = await session.authorize(toolkit, { callbackUrl });
    if (!req.redirectUrl) throw new Error('Composio did not return a redirect URL for this toolkit');
    return { redirectUrl: req.redirectUrl, connectedAccountId: req.id };
  }

  /**
   * Verifies state with Composio AND that the account belongs to this Composio user. A callback
   * query parameter is never proof of ownership.
   */
  async verify(composioUserId: string, toolkit: Toolkit, connectedAccountId: string): Promise<VerifiedConnection> {
    const owned = await this.composio.connectedAccounts.list({ userIds: [composioUserId], toolkitSlugs: [toolkit] });
    const match = owned.items.find((i) => i.id === connectedAccountId);
    if (!match) return { state: 'failed', statusReason: 'connected account is not owned by this user/toolkit', toolkit: null, authConfigId: null };
    const full = await this.composio.connectedAccounts.get(connectedAccountId);
    return {
      state: mapStatus(full.status),
      statusReason: full.statusReason ?? null,
      toolkit: full.toolkit?.slug ?? null,
      authConfigId: (full.authConfig as { id?: string } | undefined)?.id ?? null,
    };
  }

  async disconnect(connectedAccountId: string): Promise<void> {
    await this.composio.connectedAccounts.delete(connectedAccountId);
  }

  /** Executes exactly one approved catalogue slug against exactly one bound account. */
  async execute(composioUserId: string, toolkit: Toolkit, connectedAccountId: string, slug: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ExecuteResult> {
    if (!CONNECTOR_CANDIDATES.some((c) => c.slug === slug && c.toolkit === toolkit)) throw new Error(`tool ${slug} is not in the curated catalogue`);
    const session = await this.composio.sessions.create(
      composioUserId,
      {
        sessionPreset: 'direct_tools',
        toolkits: [toolkit],
        tools: { [toolkit]: { enable: [slug] } },
        connectedAccounts: { [toolkit]: connectedAccountId },
        manageConnections: false,
        sandbox: { enable: false },
      },
      signal ? { signal } : undefined,
    );
    // This project has multi-account selection off, so execute rejects an `account` argument
    // (ToolRouterV2_BadRequest 4300). The account is pinned on the session above; refuse to run
    // if the session reports a different binding.
    const bound = boundAccounts(session.config, toolkit);
    if (bound && (bound.length !== 1 || bound[0] !== connectedAccountId)) {
      throw new Error(`session is not bound to the requested ${toolkit} account`);
    }
    const call = session.execute(slug, args);
    const aborted = signal
      ? new Promise<never>((_, reject) => {
          if (signal.aborted) reject(new Error('composio execution aborted'));
          signal.addEventListener('abort', () => reject(new Error('composio execution aborted')), { once: true });
        })
      : undefined;
    const res = (await (aborted ? Promise.race([call, aborted]) : call)) as { data?: unknown; error?: string | null; logId?: string; resultType?: string };
    return { ok: res.resultType ? res.resultType === 'completed' : !res.error, data: res.data ?? null, error: res.error ?? null, logId: res.logId ?? null };
  }

  /** Development/setup-time discovery of a slug's live schema. */
  async describeTool(slug: string) {
    return this.composio.tools.getRawComposioToolBySlug(slug);
  }

  async listAuthConfigs(toolkit: string) {
    return this.composio.authConfigs.list({ toolkit });
  }
}

let instance: ComposioConnector | undefined;

export function getComposio(): ComposioConnector {
  if (instance) return instance;
  const { COMPOSIO_API_KEY } = requireKeys('composio', ['COMPOSIO_API_KEY'], 'Add COMPOSIO_API_KEY to .env (see docs/credentials-checklist.md).');
  getEnv();
  instance = new ComposioConnector(COMPOSIO_API_KEY);
  return instance;
}
