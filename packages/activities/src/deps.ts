import { AsyncLocalStorage } from 'node:async_hooks';
import { hostname } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { capabilityStatus, getEnv, modelAllowlist, requireKeys, type AppEnv } from '@superagent/config';
import { VercelGatewayModelProvider, fetchGatewayCatalog, type CatalogEntry, type DecisionOutput, type DecisionRequest } from '@superagent/agent';
import { getComposio, type ExecuteResult, type Toolkit } from '@superagent/connectors';
import type { TaskEventType } from '@superagent/contracts';
import {
  addWorkspaceActiveMs,
  acquireWorkspaceLease,
  appendEvent,
  getDb,
  getOrCreateWorkspaceRow,
  releaseWorkspaceLease,
  updateWorkspace,
  type Db,
} from '@superagent/db';
import { BrowserBroker, Workspaces, realSandboxApi, type SandboxApi, type WorkspaceConfig, type WorkspaceStore } from '@superagent/execution';
import { createLogger, type Logger } from '@superagent/observability';
import { verifiedConnectorTools, type ConnectorToolSpec } from '@superagent/policy';
import { getArtifactStore, type ArtifactStore } from '@superagent/storage';

export interface ModelPort {
  decide(req: DecisionRequest): Promise<DecisionOutput>;
}

export interface ConnectorPort {
  execute(composioUserId: string, toolkit: Toolkit, connectedAccountId: string, slug: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ExecuteResult>;
}

export interface Deps {
  db: Db;
  env: AppEnv;
  log: Logger;
  workerId: string;
  store: () => ArtifactStore;
  model: () => ModelPort;
  catalog: () => Promise<Map<string, CatalogEntry>>;
  allowlist: () => string[];
  connector: () => ConnectorPort;
  connectorTools: () => ConnectorToolSpec[];
  workspaces: () => Workspaces;
  browser: BrowserBroker;
  configured: () => Set<string>;
}

/** Per-Activity task scope so workspace lifecycle callbacks can attribute events to a task. */
export const taskScope = new AsyncLocalStorage<{ ownerId: string; taskId: string }>();

export function workspaceStore(db: Db): WorkspaceStore {
  return {
    getOrCreate: (o, k, s, t) => getOrCreateWorkspaceRow(db, o, k, s, t),
    acquireLease: async (o, id, h, ttl) => Boolean(await acquireWorkspaceLease(db, o, id, h, ttl)),
    releaseLease: (o, id, h) => releaseWorkspaceLease(db, o, id, h),
    update: (o, id, patch) => updateWorkspace(db, o, id, patch),
    addActiveMs: (o, id, ms) => addWorkspaceActiveMs(db, o, id, ms),
  };
}

export function workspaceEventSink(db: Db): NonNullable<WorkspaceConfig['onEvent']> {
  return (e) => {
    const scope = taskScope.getStore();
    if (!scope) return;
    void appendEvent(db, {
      ownerId: scope.ownerId,
      taskId: scope.taskId,
      type: e.type,
      dedupeKey: `${e.type}:${e.sandboxId ?? e.workspaceId}:${randomUUID().slice(0, 8)}`,
      data: { workspaceId: e.workspaceId, sandboxId: e.sandboxId ?? null, detail: e.detail ?? null },
    }).catch(() => undefined);
  };
}

export function configuredCapabilities(env: AppEnv): Set<string> {
  const out = new Set<string>();
  for (const [k, v] of Object.entries(capabilityStatus(env))) if (v.configured) out.add(k);
  return out;
}

export function createRealDeps(sandboxApi?: SandboxApi): Deps {
  const env = getEnv();
  const db = getDb();
  const workerId = `${hostname()}:${process.pid}:${randomBytes(3).toString('hex')}`;
  let model: ModelPort | undefined;
  let ws: Workspaces | undefined;
  return {
    db,
    env,
    log: createLogger('activities'),
    workerId,
    store: getArtifactStore,
    model: () => {
      if (!model) {
        const { AI_GATEWAY_API_KEY } = requireKeys('gateway', ['AI_GATEWAY_API_KEY']);
        model = new VercelGatewayModelProvider({
          apiKey: AI_GATEWAY_API_KEY,
          providerOnly: env.AI_GATEWAY_PROVIDER_ONLY?.split(',').map((s) => s.trim()).filter(Boolean),
          reportingTags: env.AI_GATEWAY_REPORTING_TAGS,
        });
      }
      return model;
    },
    catalog: () => fetchGatewayCatalog(),
    allowlist: () => modelAllowlist(env),
    connector: () => getComposio(),
    connectorTools: () => verifiedConnectorTools(),
    workspaces: () => {
      if (!ws) {
        const { E2B_API_KEY } = requireKeys('e2b', ['E2B_API_KEY']);
        ws = new Workspaces(workspaceStore(db), sandboxApi ?? realSandboxApi(E2B_API_KEY), {
          codeTemplate: env.E2B_CODE_TEMPLATE_ID ?? 'base',
          browserTemplate: env.E2B_BROWSER_TEMPLATE_ID ?? '',
          idlePauseMs: env.E2B_IDLE_PAUSE_MINUTES * 60_000,
          codeInternetAccess: env.E2B_CODE_INTERNET_ACCESS,
          holderId: workerId,
          onEvent: workspaceEventSink(db),
        });
      }
      return ws;
    },
    browser: new BrowserBroker(),
    configured: () => configuredCapabilities(env),
  };
}

export async function emit(d: Pick<Deps, 'db'>, ownerId: string, taskId: string, type: TaskEventType, dedupeKey: string, data: Record<string, unknown> = {}) {
  await appendEvent(d.db, { ownerId, taskId, type, dedupeKey, data });
}
