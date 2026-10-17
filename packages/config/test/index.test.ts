import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EnvSchema,
  SetupRequiredError,
  capabilityStatus,
  composioAuthConfigs,
  getEnv,
  loadLocalEnv,
  modelAllowlist,
  requireKeys,
  resetEnvCache,
} from '../src';

/** Clears every schema key so the developer's shell environment cannot leak into getEnv(). */
function clearSchemaEnv() {
  for (const key of Object.keys(EnvSchema.shape)) vi.stubEnv(key, undefined);
}

beforeAll(() => {
  // Marks the module-level loader as done so getEnv() never reads the real repo .env.
  loadLocalEnv(join(tmpdir(), 'superagent-config-test-missing.env'));
});

describe('EnvSchema', () => {
  it('applies defaults to an empty environment', () => {
    const env = EnvSchema.parse({});
    expect(env.APP_ENV).toBe('development');
    expect(env.API_PORT).toBe(3001);
    expect(env.ALLOW_SIGNUP).toBe(true);
    expect(env.S3_FORCE_PATH_STYLE).toBe(true);
    expect(env.E2B_CODE_INTERNET_ACCESS).toBe(false);
    expect(env.TEMPORAL_MODE).toBe('local');
    expect(env.MAX_ARTIFACT_BYTES).toBe(25 * 1024 * 1024);
    expect(env.COST_CURRENCY).toBe('USD');
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it('trims optional strings and treats blank values as unset', () => {
    const env = EnvSchema.parse({ DATABASE_URL: '  postgres://x  ', COMPOSIO_API_KEY: '   ' });
    expect(env.DATABASE_URL).toBe('postgres://x');
    expect(env.COMPOSIO_API_KEY).toBeUndefined();
  });

  it.each([
    ['1', true],
    ['TRUE', true],
    ['yes', true],
    ['on', true],
    ['0', false],
    ['false', false],
    ['', true],
  ])('parses ALLOW_SIGNUP=%j as %s', (raw, expected) => {
    expect(EnvSchema.parse({ ALLOW_SIGNUP: raw }).ALLOW_SIGNUP).toBe(expected);
  });

  it('parses integers and rejects non-positive or non-numeric values', () => {
    expect(EnvSchema.parse({ API_PORT: '8080' }).API_PORT).toBe(8080);
    expect(EnvSchema.safeParse({ API_PORT: '0' }).success).toBe(false);
    expect(EnvSchema.safeParse({ API_PORT: 'abc' }).success).toBe(false);
  });

  it('validates USD amounts', () => {
    expect(EnvSchema.parse({ MAX_COST_PER_RUN: ' 1.25 ' }).MAX_COST_PER_RUN).toBe('1.25');
    expect(EnvSchema.parse({ MAX_COST_PER_RUN: '' }).MAX_COST_PER_RUN).toBeUndefined();
    expect(EnvSchema.safeParse({ MAX_COST_PER_RUN: '-1' }).success).toBe(false);
    expect(EnvSchema.safeParse({ MAX_COST_PER_RUN: '$5' }).success).toBe(false);
  });

  it('rejects invalid enums and URLs', () => {
    expect(EnvSchema.safeParse({ APP_ENV: 'staging' }).success).toBe(false);
    expect(EnvSchema.safeParse({ WEB_ORIGIN: 'not a url' }).success).toBe(false);
  });

  it('rejects Temporal Cloud credentials in local mode', () => {
    const r = EnvSchema.safeParse({ TEMPORAL_API_KEY: 'k' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['TEMPORAL_MODE']);
  });

  it('requires a real endpoint, namespace and one credential kind in cloud mode', () => {
    const bare = EnvSchema.safeParse({ TEMPORAL_MODE: 'cloud' });
    expect(bare.success).toBe(false);
    expect(bare.error?.issues.map((i) => i.path[0]).sort()).toEqual([
      'TEMPORAL_ADDRESS',
      'TEMPORAL_API_KEY',
      'TEMPORAL_NAMESPACE',
    ]);

    const cloud = {
      TEMPORAL_MODE: 'cloud',
      TEMPORAL_ADDRESS: 'ns.acct.tmprl.cloud:7233',
      TEMPORAL_NAMESPACE: 'ns.acct',
    };
    expect(EnvSchema.safeParse({ ...cloud, TEMPORAL_API_KEY: 'k' }).success).toBe(true);
    expect(EnvSchema.safeParse({ ...cloud, TEMPORAL_TLS_CERT_PATH: '/c', TEMPORAL_TLS_KEY_PATH: '/k' }).success).toBe(
      true,
    );
    expect(
      EnvSchema.safeParse({
        ...cloud,
        TEMPORAL_API_KEY: 'k',
        TEMPORAL_TLS_CERT_PATH: '/c',
        TEMPORAL_TLS_KEY_PATH: '/k',
      }).success,
    ).toBe(false);
  });

  it('forbids dev seed credentials in production', () => {
    expect(EnvSchema.safeParse({ APP_ENV: 'production', DEV_SEED_EMAIL: 'a@b.c' }).success).toBe(false);
    expect(EnvSchema.safeParse({ APP_ENV: 'development', DEV_SEED_EMAIL: 'a@b.c' }).success).toBe(true);
  });
});

describe('getEnv / requireKeys', () => {
  beforeEach(() => {
    clearSchemaEnv();
    resetEnvCache();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it('reads process.env and caches until reset', () => {
    vi.stubEnv('API_PORT', '4000');
    expect(getEnv().API_PORT).toBe(4000);
    vi.stubEnv('API_PORT', '5000');
    expect(getEnv().API_PORT).toBe(4000);
    resetEnvCache();
    expect(getEnv().API_PORT).toBe(5000);
  });

  it('throws a readable error for invalid configuration', () => {
    vi.stubEnv('APP_ENV', 'staging');
    expect(() => getEnv()).toThrow(/Invalid configuration:\n {2}- APP_ENV:/);
  });

  it('returns the requested keys when present', () => {
    vi.stubEnv('COMPOSIO_API_KEY', 'test-key');
    vi.stubEnv('DATABASE_URL', 'postgres://localhost/test');
    expect(requireKeys('x', ['COMPOSIO_API_KEY', 'DATABASE_URL'])).toEqual({
      COMPOSIO_API_KEY: 'test-key',
      DATABASE_URL: 'postgres://localhost/test',
    });
  });

  it('throws SetupRequiredError listing the missing keys', () => {
    vi.stubEnv('S3_ENDPOINT', 'http://localhost:9000');
    let err: unknown;
    try {
      requireKeys('storage', ['S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'], 'Run setup.');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SetupRequiredError);
    const setup = err as SetupRequiredError;
    expect(setup.capability).toBe('storage');
    expect(setup.missing).toEqual(['S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']);
    expect(setup.message).toBe(
      'storage is not configured. Missing: S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY. Run setup.',
    );
    expect(setup.name).toBe('SetupRequiredError');
  });
});

describe('loadLocalEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('loads a file once without overriding existing variables', async () => {
    vi.resetModules();
    const fresh = await import('../src');
    const dir = mkdtempSync(join(tmpdir(), 'superagent-config-'));
    try {
      const first = join(dir, 'first.env');
      const second = join(dir, 'second.env');
      writeFileSync(first, 'SUPERAGENT_TEST_LOADED=from-file\nSUPERAGENT_TEST_KEPT=from-file\n');
      writeFileSync(second, 'SUPERAGENT_TEST_SECOND=yes\n');
      vi.stubEnv('SUPERAGENT_TEST_LOADED', undefined);
      vi.stubEnv('SUPERAGENT_TEST_SECOND', undefined);
      vi.stubEnv('SUPERAGENT_TEST_KEPT', 'from-process');
      fresh.loadLocalEnv(first);
      fresh.loadLocalEnv(second);
      expect(process.env.SUPERAGENT_TEST_LOADED).toBe('from-file');
      expect(process.env.SUPERAGENT_TEST_KEPT).toBe('from-process');
      expect(process.env.SUPERAGENT_TEST_SECOND).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('capabilityStatus', () => {
  it('reports missing keys per capability', () => {
    const status = capabilityStatus(EnvSchema.parse({ DATABASE_URL: 'postgres://x', E2B_API_KEY: 'e' }));
    expect(status.database).toEqual({ configured: true, missing: [] });
    expect(status.auth).toEqual({ configured: false, missing: ['BETTER_AUTH_SECRET'] });
    expect(status.e2b_code.missing).toEqual(['E2B_CODE_TEMPLATE_ID']);
    expect(status.budget.missing).toEqual(['MAX_COST_PER_RUN', 'MONTHLY_COST_LIMIT']);
    expect(status.temporal.configured).toBe(true);
  });
});

describe('composioAuthConfigs', () => {
  it('maps configured toolkits and skips unset ones', () => {
    const env = EnvSchema.parse({ COMPOSIO_AUTH_CONFIG_GITHUB: 'ac_abc123', COMPOSIO_AUTH_CONFIG_SLACK: 'ac_x-y_z' });
    expect(composioAuthConfigs(env)).toEqual({ github: 'ac_abc123', slack: 'ac_x-y_z' });
  });

  it('rejects values that do not look like auth config ids', () => {
    const env = EnvSchema.parse({ COMPOSIO_AUTH_CONFIG_GMAIL: 'not-an-id' });
    expect(() => composioAuthConfigs(env)).toThrow('COMPOSIO_AUTH_CONFIG_GMAIL must look like ac_...');
  });
});

describe('modelAllowlist', () => {
  it('splits the list and appends the primary and browser models once', () => {
    const env = EnvSchema.parse({
      AI_MODEL_ALLOWLIST: ' a/one , ,b/two',
      AI_MODEL_PRIMARY: 'b/two',
      AI_MODEL_BROWSER: 'c/three',
    });
    expect(modelAllowlist(env)).toEqual(['a/one', 'b/two', 'c/three']);
  });

  it('is empty when nothing is configured', () => {
    expect(modelAllowlist(EnvSchema.parse({}))).toEqual([]);
  });
});
