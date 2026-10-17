import { Sandbox } from 'e2b';
import { SANDBOX_DENY_CIDRS_V4 } from '@superagent/policy';

export type WorkspaceKind = 'code' | 'browser';

export interface WorkspaceRow {
  id: string;
  ownerId: string;
  kind: string;
  scope: string;
  templateId: string;
  sandboxId: string | null;
  state: string;
}

/** Persistence port so this package does not depend on the DB package (and is unit-testable). */
export interface WorkspaceStore {
  getOrCreate(ownerId: string, kind: WorkspaceKind, scope: string, templateId: string): Promise<WorkspaceRow>;
  acquireLease(ownerId: string, workspaceId: string, holder: string, ttlMs: number): Promise<boolean>;
  releaseLease(ownerId: string, workspaceId: string, holder: string): Promise<void>;
  update(
    ownerId: string,
    workspaceId: string,
    patch: Partial<Pick<WorkspaceRow, 'sandboxId' | 'state'>> & { lastError?: string | null },
  ): Promise<void>;
  addActiveMs(ownerId: string, workspaceId: string, ms: number): Promise<void>;
}

/** Minimal surface of the E2B SDK we rely on; real implementation below, fakes in tests. */
export interface SandboxApi {
  create(template: string, opts: Parameters<typeof Sandbox.create>[1]): Promise<Sandbox>;
  connect(sandboxId: string, opts: { timeoutMs: number }): Promise<Sandbox>;
  listByMetadata(
    metadata: Record<string, string>,
  ): Promise<Array<{ sandboxId: string; state: string; metadata: Record<string, string> }>>;
  kill(sandboxId: string): Promise<boolean>;
}

export function realSandboxApi(apiKey: string): SandboxApi {
  return {
    create: (template, opts) => Sandbox.create(template, { ...opts, apiKey }),
    connect: (id, opts) => Sandbox.connect(id, { apiKey, timeoutMs: opts.timeoutMs }),
    listByMetadata: async (metadata) => {
      const pager = Sandbox.list({ apiKey, query: { metadata, state: ['running', 'paused'] } });
      const out: Array<{ sandboxId: string; state: string; metadata: Record<string, string> }> = [];
      while (pager.hasNext)
        for (const s of await pager.nextItems())
          out.push({ sandboxId: s.sandboxId, state: s.state, metadata: s.metadata ?? {} });
      return out;
    },
    kill: (id) => Sandbox.kill(id, { apiKey }),
  };
}

export class WorkspaceBusyError extends Error {
  constructor() {
    super('workspace is busy with another operation');
    this.name = 'WorkspaceBusyError';
  }
}

export interface WorkspaceConfig {
  codeTemplate: string;
  browserTemplate: string;
  idlePauseMs: number;
  codeInternetAccess: boolean;
  holderId: string;
  leaseTtlMs?: number;
  onEvent?: (e: {
    type: 'workspace.created' | 'workspace.resumed' | 'workspace.lost' | 'workspace.adopted' | 'workspace.paused';
    workspaceId: string;
    sandboxId?: string;
    detail?: string;
  }) => void;
}

export const APP_METADATA = 'superagent';

/**
 * Per-user (code) or per-task (browser) E2B sandboxes with DB-tracked handles and leases.
 * - The row is registered BEFORE allocation and tagged into sandbox metadata, so a crash between
 *   create and DB update is reconciled via metadata listing instead of leaking a second sandbox.
 * - Sandboxes use lifecycle.onTimeout='pause' with timeout = idle target, so idle workspaces pause.
 */
export class Workspaces {
  constructor(
    private readonly store: WorkspaceStore,
    private readonly api: SandboxApi,
    private readonly cfg: WorkspaceConfig,
  ) {}

  private templateFor(kind: WorkspaceKind) {
    return kind === 'code' ? this.cfg.codeTemplate : this.cfg.browserTemplate;
  }

  async with<T>(
    ownerId: string,
    kind: WorkspaceKind,
    scope: string,
    fn: (sbx: Sandbox, row: WorkspaceRow) => Promise<T>,
  ): Promise<T> {
    const row = await this.store.getOrCreate(ownerId, kind, scope, this.templateFor(kind));
    const ok = await this.store.acquireLease(ownerId, row.id, this.cfg.holderId, this.cfg.leaseTtlMs ?? 10 * 60_000);
    if (!ok) throw new WorkspaceBusyError();
    const started = Date.now();
    try {
      const sbx = await this.ensure(row, kind);
      return await fn(sbx, row);
    } finally {
      await this.store.addActiveMs(ownerId, row.id, Date.now() - started).catch(() => undefined);
      await this.store.releaseLease(ownerId, row.id, this.cfg.holderId).catch(() => undefined);
    }
  }

  private async ensure(row: WorkspaceRow, kind: WorkspaceKind): Promise<Sandbox> {
    if (row.sandboxId && (row.state === 'running' || row.state === 'paused')) {
      try {
        const sbx = await this.api.connect(row.sandboxId, { timeoutMs: this.cfg.idlePauseMs });
        await this.store.update(row.ownerId, row.id, { state: 'running' });
        this.cfg.onEvent?.({ type: 'workspace.resumed', workspaceId: row.id, sandboxId: row.sandboxId });
        return sbx;
      } catch (err) {
        await this.store.update(row.ownerId, row.id, { state: 'lost', sandboxId: null, lastError: errMsg(err) });
        this.cfg.onEvent?.({
          type: 'workspace.lost',
          workspaceId: row.id,
          sandboxId: row.sandboxId,
          detail: 'previous sandbox could not be resumed; exported artifacts remain in durable storage',
        });
      }
    }
    // Reconcile possible orphan from an earlier crash between create and DB update.
    const orphans = await this.api.listByMetadata({ app: APP_METADATA, workspaceId: row.id });
    if (orphans.length) {
      const [keep, ...extra] = orphans;
      for (const e of extra) await this.api.kill(e.sandboxId).catch(() => undefined);
      const sbx = await this.api.connect(keep!.sandboxId, { timeoutMs: this.cfg.idlePauseMs });
      await this.store.update(row.ownerId, row.id, { sandboxId: keep!.sandboxId, state: 'running', lastError: null });
      this.cfg.onEvent?.({ type: 'workspace.adopted', workspaceId: row.id, sandboxId: keep!.sandboxId });
      return sbx;
    }
    await this.store.update(row.ownerId, row.id, { state: 'creating', sandboxId: null });
    const sbx = await this.api.create(this.templateFor(kind), {
      metadata: { app: APP_METADATA, workspaceId: row.id, kind },
      timeoutMs: this.cfg.idlePauseMs,
      lifecycle: { onTimeout: 'pause', autoResume: false },
      ...(kind === 'code'
        ? { allowInternetAccess: this.cfg.codeInternetAccess, network: { allowPublicTraffic: false } }
        : { allowInternetAccess: true, network: { allowPublicTraffic: false, denyOut: SANDBOX_DENY_CIDRS_V4 } }),
    });
    await this.store.update(row.ownerId, row.id, { sandboxId: sbx.sandboxId, state: 'running', lastError: null });
    this.cfg.onEvent?.({ type: 'workspace.created', workspaceId: row.id, sandboxId: sbx.sandboxId });
    return sbx;
  }

  /** Deliberate pause (e.g. before a long approval wait). Data persists in the E2B snapshot. */
  async pause(ownerId: string, kind: WorkspaceKind, scope: string): Promise<'paused' | 'none'> {
    const row = await this.store.getOrCreate(ownerId, kind, scope, this.templateFor(kind));
    if (!row.sandboxId || row.state !== 'running') return 'none';
    try {
      const sbx = await this.api.connect(row.sandboxId, { timeoutMs: 60_000 });
      await sbx.pause();
      await this.store.update(ownerId, row.id, { state: 'paused' });
      this.cfg.onEvent?.({ type: 'workspace.paused', workspaceId: row.id, sandboxId: row.sandboxId });
      return 'paused';
    } catch (err) {
      await this.store.update(ownerId, row.id, { lastError: errMsg(err) });
      return 'none';
    }
  }

  async kill(ownerId: string, kind: WorkspaceKind, scope: string): Promise<void> {
    const row = await this.store.getOrCreate(ownerId, kind, scope, this.templateFor(kind));
    if (row.sandboxId) await this.api.kill(row.sandboxId).catch(() => undefined);
    await this.store.update(ownerId, row.id, { state: 'killed', sandboxId: null });
  }
}

/**
 * Startup/periodic sweep: kills app-tagged sandboxes that no DB workspace row currently claims
 * (crash between create and DB update, killed/lost rows, deleted users). Only touches sandboxes
 * carrying this app's metadata tag.
 */
export async function reconcileOrphanSandboxes(
  api: SandboxApi,
  claimedBy: (workspaceId: string) => Promise<{ sandboxId: string | null; state: string } | undefined>,
): Promise<{ checked: number; killed: string[] }> {
  const all = await api.listByMetadata({ app: APP_METADATA });
  const killed: string[] = [];
  for (const s of all) {
    const wsId = s.metadata.workspaceId;
    const row = wsId ? await claimedBy(wsId) : undefined;
    const claimed = row && row.sandboxId === s.sandboxId && (row.state === 'running' || row.state === 'paused');
    // A row in 'creating' without a sandbox id may be mid-create: leave it for ensure() to adopt.
    const creating = row && row.state === 'creating' && row.sandboxId === null;
    if (!claimed && !creating) {
      await api.kill(s.sandboxId).catch(() => undefined);
      killed.push(s.sandboxId);
    }
  }
  return { checked: all.length, killed };
}

function errMsg(err: unknown) {
  return err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 300) : 'unknown error';
}
