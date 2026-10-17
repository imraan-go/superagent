import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EnvSchema, SetupRequiredError, loadLocalEnv, resetEnvCache } from '@superagent/config';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComposioConnector, getComposio } from '../src';

const fake = vi.hoisted(() => {
  const state = {
    options: [] as unknown[],
    session: {
      config: undefined as unknown,
      authorize: vi.fn(),
      execute: vi.fn(),
    },
    sessions: { create: vi.fn() },
    connectedAccounts: { list: vi.fn(), get: vi.fn(), delete: vi.fn() },
    tools: { getRawComposioToolBySlug: vi.fn() },
    authConfigs: { list: vi.fn() },
  };
  return state;
});

vi.mock('@composio/core', () => ({
  Composio: class {
    sessions = fake.sessions;
    connectedAccounts = fake.connectedAccounts;
    tools = fake.tools;
    authConfigs = fake.authConfigs;
    constructor(opts: unknown) {
      fake.options.push(opts);
    }
  },
}));

const USER = 'composio-user-1';
const ACCOUNT = 'ca_owned';
const SLUG = 'GITHUB_GET_THE_AUTHENTICATED_USER';

beforeAll(() => {
  // Marks the config loader as done so nothing reads the real repo .env.
  loadLocalEnv(join(tmpdir(), 'superagent-connectors-test-missing.env'));
});

beforeEach(() => {
  for (const key of Object.keys(EnvSchema.shape)) vi.stubEnv(key, undefined);
  resetEnvCache();
  vi.clearAllMocks();
  fake.options.length = 0;
  fake.session.config = undefined;
  fake.sessions.create.mockResolvedValue(fake.session);
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe('ComposioConnector construction', () => {
  it('disables tracking and pins toolkit versions from the lock file', () => {
    new ComposioConnector('test-key');
    const opts = fake.options[0] as { apiKey: string; allowTracking: boolean; toolkitVersions: Record<string, string> };
    expect(opts.apiKey).toBe('test-key');
    expect(opts.allowTracking).toBe(false);
    expect(opts.toolkitVersions.github).toMatch(/\S/);
  });
});

describe('initiate', () => {
  it('creates a direct-tools session with the configured auth config and returns the redirect', async () => {
    vi.stubEnv('COMPOSIO_AUTH_CONFIG_GITHUB', 'ac_github1');
    fake.session.authorize.mockResolvedValue({ redirectUrl: 'https://connect.example/abc', id: 'ca_new' });
    const c = new ComposioConnector('test-key', {});
    await expect(c.initiate(USER, 'github', 'http://localhost:3000/cb')).resolves.toEqual({
      redirectUrl: 'https://connect.example/abc',
      connectedAccountId: 'ca_new',
    });
    expect(fake.sessions.create).toHaveBeenCalledWith(USER, {
      sessionPreset: 'direct_tools',
      toolkits: ['github'],
      authConfigs: { github: 'ac_github1' },
      manageConnections: false,
      sandbox: { enable: false },
    });
    expect(fake.session.authorize).toHaveBeenCalledWith('github', { callbackUrl: 'http://localhost:3000/cb' });
  });

  it('omits authConfigs when none is configured for the toolkit', async () => {
    fake.session.authorize.mockResolvedValue({ redirectUrl: 'https://connect.example/x', id: 'ca_new' });
    await new ComposioConnector('test-key', {}).initiate(USER, 'slack', 'http://localhost/cb');
    expect(fake.sessions.create.mock.calls[0]![1]).not.toHaveProperty('authConfigs');
  });

  it('fails when Composio returns no redirect URL', async () => {
    fake.session.authorize.mockResolvedValue({ redirectUrl: null, id: 'ca_new' });
    await expect(new ComposioConnector('test-key', {}).initiate(USER, 'github', 'http://localhost/cb')).rejects.toThrow(
      'did not return a redirect URL',
    );
  });
});

describe('verify', () => {
  it('rejects an account the user does not own without fetching it', async () => {
    fake.connectedAccounts.list.mockResolvedValue({ items: [{ id: 'ca_other' }] });
    const v = await new ComposioConnector('test-key', {}).verify(USER, 'github', ACCOUNT);
    expect(v).toEqual({
      state: 'failed',
      statusReason: 'connected account is not owned by this user/toolkit',
      toolkit: null,
      authConfigId: null,
    });
    expect(fake.connectedAccounts.list).toHaveBeenCalledWith({ userIds: [USER], toolkitSlugs: ['github'] });
    expect(fake.connectedAccounts.get).not.toHaveBeenCalled();
  });

  it.each([
    ['ACTIVE', 'active'],
    ['EXPIRED', 'expired'],
    ['REVOKED', 'revoked'],
    ['FAILED', 'failed'],
    ['INACTIVE', 'disconnected'],
    ['INITIATED', 'initiated'],
    [undefined, 'initiated'],
  ])('maps Composio status %s to %s', async (status, state) => {
    fake.connectedAccounts.list.mockResolvedValue({ items: [{ id: ACCOUNT }] });
    fake.connectedAccounts.get.mockResolvedValue({ status, toolkit: { slug: 'github' }, authConfig: { id: 'ac_1' } });
    const v = await new ComposioConnector('test-key', {}).verify(USER, 'github', ACCOUNT);
    expect(v).toEqual({ state, statusReason: null, toolkit: 'github', authConfigId: 'ac_1' });
  });
});

describe('execute', () => {
  it('refuses slugs outside the curated catalogue before calling Composio', async () => {
    const c = new ComposioConnector('test-key', {});
    await expect(c.execute(USER, 'github', ACCOUNT, 'GITHUB_DELETE_REPO', {})).rejects.toThrow(
      'not in the curated catalogue',
    );
    await expect(c.execute(USER, 'slack', ACCOUNT, SLUG, {})).rejects.toThrow('not in the curated catalogue');
    expect(fake.sessions.create).not.toHaveBeenCalled();
  });

  it('pins the session to one tool and one account and maps a completed result', async () => {
    fake.session.config = { connectedAccounts: { github: ACCOUNT } };
    fake.session.execute.mockResolvedValue({
      data: { login: 'me' },
      error: null,
      logId: 'log_1',
      resultType: 'completed',
    });
    const r = await new ComposioConnector('test-key', {}).execute(USER, 'github', ACCOUNT, SLUG, { a: 1 });
    expect(r).toEqual({ ok: true, data: { login: 'me' }, error: null, logId: 'log_1' });
    expect(fake.sessions.create).toHaveBeenCalledWith(
      USER,
      {
        sessionPreset: 'direct_tools',
        toolkits: ['github'],
        tools: { github: { enable: [SLUG] } },
        connectedAccounts: { github: ACCOUNT },
        manageConnections: false,
        sandbox: { enable: false },
      },
      undefined,
    );
    expect(fake.session.execute).toHaveBeenCalledWith(SLUG, { a: 1 });
  });

  it('reports failures from the error field when no resultType is present', async () => {
    fake.session.execute.mockResolvedValue({ error: 'rate limited' });
    const r = await new ComposioConnector('test-key', {}).execute(USER, 'github', ACCOUNT, SLUG, {});
    expect(r).toEqual({ ok: false, data: null, error: 'rate limited', logId: null });
  });

  it('treats a non-completed resultType as a failure', async () => {
    fake.session.execute.mockResolvedValue({ data: {}, resultType: 'failed' });
    const r = await new ComposioConnector('test-key', {}).execute(USER, 'github', ACCOUNT, SLUG, {});
    expect(r.ok).toBe(false);
  });

  it.each([
    ['a different account', { connected_accounts: { github: 'ca_someone_else' } }],
    ['several accounts', { connectedAccounts: { github: [ACCOUNT, 'ca_two'] } }],
  ])('refuses to run when the session reports %s', async (_label, config) => {
    fake.session.config = config;
    await expect(new ComposioConnector('test-key', {}).execute(USER, 'github', ACCOUNT, SLUG, {})).rejects.toThrow(
      'session is not bound to the requested github account',
    );
    expect(fake.session.execute).not.toHaveBeenCalled();
  });

  it('rejects when the signal is already aborted and forwards it to session creation', async () => {
    fake.session.execute.mockReturnValue(new Promise(() => undefined));
    const controller = new AbortController();
    controller.abort();
    await expect(
      new ComposioConnector('test-key', {}).execute(USER, 'github', ACCOUNT, SLUG, {}, controller.signal),
    ).rejects.toThrow('composio execution aborted');
    expect(fake.sessions.create.mock.calls[0]![2]).toEqual({ signal: controller.signal });
  });

  it('rejects when the signal aborts mid-execution', async () => {
    fake.session.execute.mockReturnValue(new Promise(() => undefined));
    const controller = new AbortController();
    const run = new ComposioConnector('test-key', {}).execute(USER, 'github', ACCOUNT, SLUG, {}, controller.signal);
    await vi.waitFor(() => expect(fake.session.execute).toHaveBeenCalled());
    controller.abort();
    await expect(run).rejects.toThrow('composio execution aborted');
  });
});

describe('pass-through calls', () => {
  it('disconnects, describes tools and lists auth configs via the client', async () => {
    fake.tools.getRawComposioToolBySlug.mockResolvedValue({ slug: SLUG });
    fake.authConfigs.list.mockResolvedValue({ items: [] });
    const c = new ComposioConnector('test-key', {});
    await c.disconnect(ACCOUNT);
    expect(fake.connectedAccounts.delete).toHaveBeenCalledWith(ACCOUNT);
    await expect(c.describeTool(SLUG)).resolves.toEqual({ slug: SLUG });
    await expect(c.listAuthConfigs('github')).resolves.toEqual({ items: [] });
    expect(fake.authConfigs.list).toHaveBeenCalledWith({ toolkit: 'github' });
  });
});

describe('getComposio', () => {
  it('requires COMPOSIO_API_KEY', () => {
    expect(() => getComposio()).toThrow(SetupRequiredError);
  });

  it('builds a single shared instance from the environment', () => {
    vi.stubEnv('COMPOSIO_API_KEY', 'test-key');
    const a = getComposio();
    expect(getComposio()).toBe(a);
    expect(fake.options).toHaveLength(1);
    expect((fake.options[0] as { apiKey: string }).apiKey).toBe('test-key');
  });
});
