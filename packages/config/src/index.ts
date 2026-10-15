import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

let loaded = false;

/**
 * Loads the gitignored root `.env` into process.env. Variables already present in the
 * process environment win (Node's loadEnvFile does not override existing keys).
 */
export function loadLocalEnv(path = join(REPO_ROOT, '.env')): void {
  if (loaded) return;
  loaded = true;
  if (existsSync(path)) process.loadEnvFile(path);
}

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()));

const usd = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : typeof v === 'string' ? v.trim() : v),
  z.string().regex(/^\d+(\.\d{1,9})?$/, 'must be a non-negative decimal USD amount').optional(),
);

const intWithDefault = (d: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? d : Number.parseInt(v, 10)))
    .pipe(z.number().int().positive());

const boolWithDefault = (d: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

export const EnvSchema = z
  .object({
    APP_ENV: z.enum(['development', 'test', 'production']).default('development'),
    WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
    API_ORIGIN: z.string().url().default('http://localhost:3001'),
    API_PORT: intWithDefault(3001),
    API_HOST: z.string().trim().min(1).default('127.0.0.1'),

    DATABASE_URL: optionalString,
    BETTER_AUTH_SECRET: optionalString,
    DEV_SEED_EMAIL: optionalString,
    DEV_SEED_PASSWORD: optionalString,
    ALLOW_SIGNUP: boolWithDefault(true),

    S3_ENDPOINT: optionalString,
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().default('superagent-artifacts'),
    S3_ACCESS_KEY_ID: optionalString,
    S3_SECRET_ACCESS_KEY: optionalString,
    S3_FORCE_PATH_STYLE: boolWithDefault(true),

    AI_GATEWAY_API_KEY: optionalString,
    AI_MODEL_PRIMARY: optionalString,
    AI_MODEL_BROWSER: optionalString,
    AI_MODEL_ALLOWLIST: optionalString,
    AI_GATEWAY_PROVIDER_ONLY: optionalString,
    AI_GATEWAY_REPORTING_TAGS: boolWithDefault(false),
    AI_MAX_OUTPUT_TOKENS: intWithDefault(1500),

    COMPOSIO_API_KEY: optionalString,
    COMPOSIO_AUTH_CONFIG_GITHUB: optionalString,
    COMPOSIO_AUTH_CONFIG_GOOGLECALENDAR: optionalString,
    COMPOSIO_AUTH_CONFIG_GOOGLEDRIVE: optionalString,
    COMPOSIO_AUTH_CONFIG_GMAIL: optionalString,
    COMPOSIO_AUTH_CONFIG_NOTION: optionalString,

    E2B_API_KEY: optionalString,
    E2B_CODE_TEMPLATE_ID: optionalString,
    E2B_BROWSER_TEMPLATE_ID: optionalString,
    E2B_CODE_INTERNET_ACCESS: boolWithDefault(false),
    /** Explicit user-entered E2B rate (USD per sandbox-second) with its source; unset => cost unknown. */
    E2B_RATE_USD_PER_SECOND: usd,
    E2B_RATE_SOURCE: optionalString,

    TEMPORAL_MODE: z.enum(['local', 'cloud']).default('local'),
    TEMPORAL_ADDRESS: z.string().default('localhost:7233'),
    TEMPORAL_NAMESPACE: z.string().default('default'),
    TEMPORAL_API_KEY: optionalString,
    TEMPORAL_TLS_CERT_PATH: optionalString,
    TEMPORAL_TLS_KEY_PATH: optionalString,
    TEMPORAL_TASK_QUEUE: z.string().default('personal-agent'),

    LIVE_SMOKE_MAX_COST: usd,
    MAX_COST_PER_RUN: usd,
    MONTHLY_COST_LIMIT: usd,
    COST_CURRENCY: z.literal('USD').default('USD'),

    MAX_MODEL_DECISIONS_PER_RUN: intWithDefault(20),
    MAX_TOOL_CALLS_PER_RUN: intWithDefault(30),
    MAX_ACTIVE_EXECUTION_MINUTES: intWithDefault(15),
    E2B_IDLE_PAUSE_MINUTES: intWithDefault(5),
    APPROVAL_EXPIRY_HOURS: intWithDefault(24),
    TASK_RETENTION_DAYS: intWithDefault(30),
    OPERATIONAL_LOG_RETENTION_DAYS: intWithDefault(7),
    MAX_ARTIFACT_BYTES: intWithDefault(25 * 1024 * 1024),
  })
  .superRefine((env, ctx) => {
    if (env.TEMPORAL_MODE === 'cloud') {
      if (env.TEMPORAL_ADDRESS.startsWith('localhost') || env.TEMPORAL_ADDRESS.startsWith('127.')) {
        ctx.addIssue({ code: 'custom', path: ['TEMPORAL_ADDRESS'], message: 'cloud mode requires a Temporal Cloud endpoint, not localhost' });
      }
      if (env.TEMPORAL_NAMESPACE === 'default') {
        ctx.addIssue({ code: 'custom', path: ['TEMPORAL_NAMESPACE'], message: 'cloud mode requires your <namespace>.<account-id> namespace' });
      }
      const mtls = Boolean(env.TEMPORAL_TLS_CERT_PATH && env.TEMPORAL_TLS_KEY_PATH);
      if (!env.TEMPORAL_API_KEY && !mtls) {
        ctx.addIssue({ code: 'custom', path: ['TEMPORAL_API_KEY'], message: 'cloud mode requires TEMPORAL_API_KEY or TEMPORAL_TLS_CERT_PATH + TEMPORAL_TLS_KEY_PATH' });
      }
      if (env.TEMPORAL_API_KEY && mtls) {
        ctx.addIssue({ code: 'custom', path: ['TEMPORAL_API_KEY'], message: 'choose either API key or mTLS for Temporal Cloud, not both' });
      }
    } else if (env.TEMPORAL_API_KEY || env.TEMPORAL_TLS_CERT_PATH) {
      ctx.addIssue({ code: 'custom', path: ['TEMPORAL_MODE'], message: 'local mode must not carry Temporal Cloud credentials; set TEMPORAL_MODE=cloud or remove them' });
    }
    if (env.APP_ENV === 'production' && (env.DEV_SEED_PASSWORD || env.DEV_SEED_EMAIL)) {
      ctx.addIssue({ code: 'custom', path: ['DEV_SEED_PASSWORD'], message: 'development seed credentials are not allowed in production' });
    }
  });

export type AppEnv = z.infer<typeof EnvSchema>;

let cached: AppEnv | undefined;

export function getEnv(): AppEnv {
  if (cached) return cached;
  loadLocalEnv();
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test-only hook to re-read configuration. */
export function resetEnvCache(): void {
  cached = undefined;
}

export class SetupRequiredError extends Error {
  constructor(
    public readonly capability: string,
    public readonly missing: string[],
    hint: string,
  ) {
    super(`${capability} is not configured. Missing: ${missing.join(', ')}. ${hint}`);
    this.name = 'SetupRequiredError';
  }
}

export function requireKeys<K extends keyof AppEnv>(capability: string, keys: K[], hint = 'See docs/credentials-checklist.md.'): { [P in K]: NonNullable<AppEnv[P]> } {
  const env = getEnv();
  const missing = keys.filter((k) => env[k] === undefined || env[k] === '');
  if (missing.length) throw new SetupRequiredError(capability, missing as string[], hint);
  return Object.fromEntries(keys.map((k) => [k, env[k]])) as { [P in K]: NonNullable<AppEnv[P]> };
}

export type Capability = 'database' | 'auth' | 'storage' | 'gateway' | 'composio' | 'e2b_code' | 'e2b_browser' | 'temporal' | 'budget';

export function capabilityStatus(env: AppEnv = getEnv()): Record<Capability, { configured: boolean; missing: string[] }> {
  const check = (keys: (keyof AppEnv)[]) => {
    const missing = keys.filter((k) => env[k] === undefined || env[k] === '') as string[];
    return { configured: missing.length === 0, missing };
  };
  return {
    database: check(['DATABASE_URL']),
    auth: check(['BETTER_AUTH_SECRET', 'DATABASE_URL']),
    storage: check(['S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']),
    gateway: check(['AI_GATEWAY_API_KEY', 'AI_MODEL_PRIMARY']),
    composio: check(['COMPOSIO_API_KEY']),
    e2b_code: check(['E2B_API_KEY', 'E2B_CODE_TEMPLATE_ID']),
    e2b_browser: check(['E2B_API_KEY', 'E2B_BROWSER_TEMPLATE_ID', 'AI_MODEL_BROWSER']),
    temporal: env.TEMPORAL_MODE === 'cloud' ? check(['TEMPORAL_ADDRESS', 'TEMPORAL_NAMESPACE']) : { configured: true, missing: [] },
    budget: check(['MAX_COST_PER_RUN', 'MONTHLY_COST_LIMIT']),
  };
}

export function composioAuthConfigs(env: AppEnv = getEnv()): Record<string, string> {
  const out: Record<string, string> = {};
  const map: Record<string, string | undefined> = {
    github: env.COMPOSIO_AUTH_CONFIG_GITHUB,
    googlecalendar: env.COMPOSIO_AUTH_CONFIG_GOOGLECALENDAR,
    googledrive: env.COMPOSIO_AUTH_CONFIG_GOOGLEDRIVE,
    gmail: env.COMPOSIO_AUTH_CONFIG_GMAIL,
    notion: env.COMPOSIO_AUTH_CONFIG_NOTION,
  };
  for (const [k, v] of Object.entries(map)) {
    if (v) {
      if (!/^ac_[A-Za-z0-9_-]+$/.test(v)) throw new Error(`COMPOSIO_AUTH_CONFIG_${k.toUpperCase()} must look like ac_...`);
      out[k] = v;
    }
  }
  return out;
}

export function modelAllowlist(env: AppEnv = getEnv()): string[] {
  const list = (env.AI_MODEL_ALLOWLIST ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const m of [env.AI_MODEL_PRIMARY, env.AI_MODEL_BROWSER]) if (m && !list.includes(m)) list.push(m);
  return list;
}
