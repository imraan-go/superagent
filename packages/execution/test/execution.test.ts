import { describe, expect, it } from 'vitest';
import type { Sandbox } from 'e2b';
import {
  BrowserBroker,
  BrowserPolicyError,
  Workspaces,
  WorkspaceBusyError,
  reconcileOrphanSandboxes,
  validateDestination,
  type SandboxApi,
  type WorkspaceRow,
  type WorkspaceStore,
} from '../src';

function memStore() {
  const rows = new Map<string, WorkspaceRow & { lease?: string }>();
  const store: WorkspaceStore = {
    getOrCreate: async (ownerId, kind, scope, templateId) => {
      const key = `${ownerId}:${kind}:${scope}`;
      if (!rows.has(key))
        rows.set(key, { id: key, ownerId, kind, scope, templateId, sandboxId: null, state: 'creating' });
      return { ...rows.get(key)! };
    },
    acquireLease: async (_o, id, holder) => {
      const r = rows.get(id)!;
      if (r.lease && r.lease !== holder) return false;
      r.lease = holder;
      return true;
    },
    releaseLease: async (_o, id, holder) => {
      const r = rows.get(id)!;
      if (r.lease === holder) r.lease = undefined;
    },
    update: async (_o, id, patch) => {
      Object.assign(rows.get(id)!, patch);
    },
    addActiveMs: async () => undefined,
  };
  return { rows, store };
}

function fakeApi() {
  const live = new Map<string, { metadata: Record<string, string>; state: string }>();
  let n = 0;
  const log: string[] = [];
  const sbx = (id: string) =>
    ({ sandboxId: id, pause: async () => void (live.get(id)!.state = 'paused') }) as unknown as Sandbox;
  const api: SandboxApi = {
    create: async (_t, opts) => {
      const id = `sbx_${++n}`;
      live.set(id, { metadata: (opts?.metadata ?? {}) as Record<string, string>, state: 'running' });
      log.push(`create:${id}`);
      return sbx(id);
    },
    connect: async (id) => {
      const s = live.get(id);
      if (!s) throw new Error('sandbox not found');
      s.state = 'running';
      log.push(`connect:${id}`);
      return sbx(id);
    },
    listByMetadata: async (m) =>
      [...live.entries()]
        .filter(([, v]) => Object.entries(m).every(([k, val]) => v.metadata[k] === val))
        .map(([sandboxId, v]) => ({ sandboxId, state: v.state, metadata: v.metadata })),
    kill: async (id) => (log.push(`kill:${id}`), live.delete(id)),
  };
  return { api, live, log };
}

const cfg = {
  codeTemplate: 'base',
  browserTemplate: 'chrome',
  idlePauseMs: 300_000,
  codeInternetAccess: false,
  holderId: 'w1',
};

describe('Workspaces (E2B lifecycle with fakes)', () => {
  it('creates once, then resumes the same sandbox', async () => {
    const { store } = memStore();
    const { api, log } = fakeApi();
    const ws = new Workspaces(store, api, cfg);
    await ws.with('u1', 'code', 'user', async () => undefined);
    await ws.with('u1', 'code', 'user', async () => undefined);
    expect(log).toEqual(['create:sbx_1', 'connect:sbx_1']);
  });

  it('marks a vanished sandbox lost and creates a fresh one', async () => {
    const { store, rows } = memStore();
    const { api, live } = fakeApi();
    const events: string[] = [];
    const ws = new Workspaces(store, api, { ...cfg, onEvent: (e) => events.push(e.type) });
    await ws.with('u1', 'code', 'user', async () => undefined);
    live.clear();
    await ws.with('u1', 'code', 'user', async () => undefined);
    expect(events).toEqual(['workspace.created', 'workspace.lost', 'workspace.created']);
    expect(rows.get('u1:code:user')!.sandboxId).toBe('sbx_2');
  });

  it('adopts an orphan created before a crash instead of leaking a second sandbox', async () => {
    const { store } = memStore();
    const { api, live, log } = fakeApi();
    await store.getOrCreate('u1', 'code', 'user', 'base');
    live.set('sbx_orphan', {
      metadata: { app: 'superagent', workspaceId: 'u1:code:user', kind: 'code' },
      state: 'running',
    });
    live.set('sbx_orphan2', {
      metadata: { app: 'superagent', workspaceId: 'u1:code:user', kind: 'code' },
      state: 'running',
    });
    const ws = new Workspaces(store, api, cfg);
    await ws.with('u1', 'code', 'user', async (s) => expect(s.sandboxId).toBe('sbx_orphan'));
    expect(log).toContain('kill:sbx_orphan2');
    expect(log.filter((l) => l.startsWith('create'))).toHaveLength(0);
  });

  it('enforces a single mutating holder per workspace', async () => {
    const { store } = memStore();
    const { api } = fakeApi();
    const a = new Workspaces(store, api, cfg);
    const b = new Workspaces(store, api, { ...cfg, holderId: 'w2' });
    await a.with('u1', 'code', 'user', async () => {
      await expect(b.with('u1', 'code', 'user', async () => undefined)).rejects.toBeInstanceOf(WorkspaceBusyError);
    });
  });

  it('isolates users: different owners never share a sandbox', async () => {
    const { store } = memStore();
    const { api } = fakeApi();
    const ws = new Workspaces(store, api, cfg);
    const ids: string[] = [];
    await ws.with('u1', 'code', 'user', async (s) => void ids.push(s.sandboxId));
    await ws.with('u2', 'code', 'user', async (s) => void ids.push(s.sandboxId));
    expect(new Set(ids).size).toBe(2);
  });

  it('pauses before long waits; code sandboxes have no internet; browser sandboxes deny private ranges', async () => {
    const { store } = memStore();
    const { api, live } = fakeApi();
    const created: unknown[] = [];
    const spy: SandboxApi = { ...api, create: async (t, o) => (created.push(o), api.create(t, o)) };
    const ws = new Workspaces(store, spy, cfg);
    await ws.with('u1', 'code', 'user', async () => undefined);
    await ws.with('u1', 'browser', 'task-1', async () => undefined);
    expect(await ws.pause('u1', 'code', 'user')).toBe('paused');
    expect(live.get('sbx_1')!.state).toBe('paused');
    expect(created[0]).toMatchObject({ allowInternetAccess: false, lifecycle: { onTimeout: 'pause' } });
    expect(JSON.stringify(created[1])).toContain('169.254.0.0/16');
  });

  it('orphan sweep kills only app-tagged sandboxes no row claims', async () => {
    const { api, live } = fakeApi();
    live.set('keep', { metadata: { app: 'superagent', workspaceId: 'w-keep' }, state: 'running' });
    live.set('stale', { metadata: { app: 'superagent', workspaceId: 'w-killed' }, state: 'paused' });
    live.set('nobody', { metadata: { app: 'superagent', workspaceId: 'w-gone' }, state: 'running' });
    live.set('creating', { metadata: { app: 'superagent', workspaceId: 'w-creating' }, state: 'running' });
    live.set('foreign', { metadata: { app: 'other-app' }, state: 'running' });
    const rows: Record<string, { sandboxId: string | null; state: string }> = {
      'w-keep': { sandboxId: 'keep', state: 'running' },
      'w-killed': { sandboxId: null, state: 'killed' },
      'w-creating': { sandboxId: null, state: 'creating' },
    };
    const r = await reconcileOrphanSandboxes(api, async (id) => rows[id]);
    expect(r.killed.sort()).toEqual(['nobody', 'stale']);
    expect(live.has('foreign')).toBe(true);
  });
});

describe('browser destination checks', () => {
  const resolver = (map: Record<string, string[]>) => async (h: string) => map[h] ?? [];
  it('rejects hosts that DNS-resolve to private ranges (rebinding style)', async () => {
    await expect(
      validateDestination('https://example.com/', ['example.com'], resolver({ 'example.com': ['10.0.0.5'] })),
    ).rejects.toBeInstanceOf(BrowserPolicyError);
    await expect(
      validateDestination(
        'https://example.com/',
        ['example.com'],
        resolver({ 'example.com': ['93.184.215.14', '127.0.0.1'] }),
      ),
    ).rejects.toBeInstanceOf(BrowserPolicyError);
    await expect(
      validateDestination('https://example.com/', ['example.com'], resolver({ 'example.com': ['93.184.215.14'] })),
    ).resolves.toBeInstanceOf(URL);
  });

  it('closes the page if a navigation redirects off the allowlist', async () => {
    const calls: string[] = [];
    const sbx = {
      commands: {
        run: async (_cmd: string, opts: { envs: { BCTL_REQ: string } }) => {
          const req = JSON.parse(Buffer.from(opts.envs.BCTL_REQ, 'base64').toString()) as { action: string };
          calls.push(req.action);
          const res =
            req.action === 'navigate'
              ? { ok: true, url: 'https://evil.example/landing', title: 'x', status: 200 }
              : { ok: true, url: 'about:blank' };
          return { stdout: `noise\nSA_RESULT ${JSON.stringify(res)}\n`, exitCode: 0 };
        },
      },
    } as unknown as Sandbox;
    const b = new BrowserBroker(resolver({ 'example.com': ['93.184.215.14'], 'evil.example': ['93.184.215.15'] }));
    await expect(b.navigate(sbx, 'https://example.com/', ['example.com'])).rejects.toThrow(/disallowed destination/);
    expect(calls).toEqual(['navigate', 'blank']);
  });
});
