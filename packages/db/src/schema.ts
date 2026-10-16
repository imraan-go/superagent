import { sql } from 'drizzle-orm';
import { bigint, bigserial, boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const created = () => ts('created_at').notNull().defaultNow();
const updated = () => ts('updated_at').notNull().defaultNow();

/* ---------- Better Auth core tables (field names verified against better-auth 1.7.9 getAuthTables) ---------- */

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: created(),
  updatedAt: updated(),
});

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: ts('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: created(),
    updatedAt: updated(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [index('session_user_idx').on(t.userId)],
);

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: ts('access_token_expires_at'),
    refreshTokenExpiresAt: ts('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index('account_user_idx').on(t.userId)],
);

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: ts('expires_at').notNull(),
  createdAt: created(),
  updatedAt: updated(),
});

/* ---------- Application domain ---------- */

const owner = () =>
  text('owner_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' });

export const userSettings = pgTable('user_settings', {
  ownerId: text('owner_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  maxCostPerRunNanos: bigint('max_cost_per_run_nanos', { mode: 'bigint' }),
  monthlyLimitNanos: bigint('monthly_limit_nanos', { mode: 'bigint' }),
  currency: text('currency').notNull().default('USD'),
  browserProfileRetention: boolean('browser_profile_retention').notNull().default(false),
  updatedAt: updated(),
});

/** A conversation. Each user turn that does work becomes one task (one Temporal workflow run). */
export const chats = pgTable(
  'chats',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: owner(),
    title: text('title').notNull().default('New chat'),
    pinned: boolean('pinned').notNull().default(false),
    archived: boolean('archived').notNull().default(false),
    model: text('model'),
    /** Composer prefs (mode, capability chips). Display state only; never authorization. */
    prefs: jsonb('prefs').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index('chats_owner_updated_idx').on(t.ownerId, t.updatedAt)],
);

export const schedules = pgTable(
  'schedules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: owner(),
    name: text('name').notNull(),
    prompt: text('prompt').notNull(),
    spec: jsonb('spec').notNull(),
    timezone: text('timezone').notNull(),
    allowedDomains: jsonb('allowed_domains').$type<string[]>().notNull().default([]),
    readOnly: boolean('read_only').notNull().default(true),
    overlapPolicy: text('overlap_policy').notNull().default('SKIP'),
    catchupWindowSeconds: integer('catchup_window_seconds').notNull().default(600),
    temporalScheduleId: text('temporal_schedule_id').notNull().unique(),
    state: text('state').notNull().default('pending_create'), // pending_create | active | paused | deleted
    /** Chat that created the routine; its runs post their results there. */
    chatId: uuid('chat_id').references(() => chats.id, { onDelete: 'set null' }),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index('schedules_owner_idx').on(t.ownerId)],
);

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: owner(),
    title: text('title').notNull(),
    prompt: text('prompt').notNull(),
    status: text('status').notNull().default('queued'),
    origin: text('origin').notNull().default('user'), // user | schedule
    scheduleId: uuid('schedule_id').references(() => schedules.id, { onDelete: 'set null' }),
    chatId: uuid('chat_id').references(() => chats.id, { onDelete: 'set null' }),
    /** Model chosen for this run (validated against the allowlist); null = installation default. */
    model: text('model'),
    /**
     * Composer chips that NARROW the tools offered to this run (computer, browser, connectors,
     * memory); null = no narrowing. Never widens what policy and configuration allow.
     */
    capabilities: jsonb('capabilities').$type<string[]>(),
    readOnly: boolean('read_only').notNull().default(false),
    allowedDomains: jsonb('allowed_domains').$type<string[]>().notNull().default([]),
    timezone: text('timezone'),
    workflowId: text('workflow_id').notNull().unique(),
    idempotencyKey: text('idempotency_key').notNull(),
    resultSummary: text('result_summary'),
    error: text('error'),
    createdAt: created(),
    updatedAt: updated(),
    completedAt: ts('completed_at'),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [uniqueIndex('tasks_owner_idem_uq').on(t.ownerId, t.idempotencyKey), index('tasks_owner_created_idx').on(t.ownerId, t.createdAt), index('tasks_chat_idx').on(t.chatId, t.createdAt)],
);

/**
 * What the chat column shows: user turns, the assistant's final answer per run, and system notes
 * (e.g. "routine paused from Settings"). Content is an array of display parts (apps/web lib/messages).
 */
export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    ownerId: owner(),
    role: text('role').notNull(), // user | assistant | system
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    model: text('model'),
    content: jsonb('content').$type<Array<Record<string, unknown>>>().notNull(),
    /** Idempotency for writes from retried Activities (e.g. `final:<taskId>`). */
    dedupeKey: text('dedupe_key').unique(),
    createdAt: created(),
  },
  (t) => [index('chat_messages_chat_idx').on(t.chatId, t.createdAt)],
);

/** Questions the agent asked the user in chat (ask_user, or a confirm gate before a tool runs). */
export const questions = pgTable(
  'questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: owner(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    chatId: uuid('chat_id').references(() => chats.id, { onDelete: 'set null' }),
    toolCallId: text('tool_call_id').notNull().unique(),
    kind: text('kind').notNull(), // single | multi | text | confirm
    prompt: text('prompt').notNull(),
    options: jsonb('options').$type<Array<{ id: string; label: string }>>().notNull().default([]),
    /** True when the question gates a tool call (Yes runs it, anything else does not). */
    gate: boolean('gate').notNull().default(false),
    status: text('status').notNull().default('pending'), // pending | answered | expired | cancelled
    answer: jsonb('answer').$type<{ choices: string[]; text?: string }>(),
    expiresAt: ts('expires_at').notNull(),
    answeredAt: ts('answered_at'),
    createdAt: created(),
  },
  (t) => [index('questions_owner_status_idx').on(t.ownerId, t.status), index('questions_chat_idx').on(t.chatId)],
);

/** Per-user UI/agent preferences by section (appearance, sound, notifications, …). */
export const userPreferences = pgTable(
  'user_preferences',
  {
    ownerId: owner(),
    section: text('section').notNull(),
    value: jsonb('value').$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: updated(),
  },
  (t) => [uniqueIndex('user_preferences_owner_section_uq').on(t.ownerId, t.section)],
);

/** Model conversation state for a task (sensitive; app storage, never Temporal history). */
export const taskMessages = pgTable(
  'task_messages',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    ownerId: owner(),
    step: integer('step').notNull(),
    kind: text('kind').notNull(), // user | assistant | tool_result
    dedupeKey: text('dedupe_key').notNull(),
    content: jsonb('content').notNull(),
    createdAt: created(),
  },
  (t) => [uniqueIndex('task_messages_dedupe_uq').on(t.taskId, t.dedupeKey), index('task_messages_task_idx').on(t.taskId, t.id)],
);

/** Tool calls proposed by the model; arguments stay here, Temporal only sees toolCallId. */
export const toolCalls = pgTable(
  'tool_calls',
  {
    id: text('id').primaryKey(), // `${taskId}:${providerToolCallId}`
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    ownerId: owner(),
    step: integer('step').notNull(),
    providerToolCallId: text('provider_tool_call_id').notNull(),
    toolName: text('tool_name').notNull(),
    input: jsonb('input'),
    status: text('status').notNull().default('proposed'), // proposed | allowed | denied | awaiting_approval | done | failed
    resultSummary: text('result_summary'),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index('tool_calls_task_idx').on(t.taskId)],
);

export const taskEvents = pgTable(
  'task_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    ownerId: owner(),
    type: text('type').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    data: jsonb('data').notNull().default({}),
    createdAt: created(),
  },
  (t) => [uniqueIndex('task_events_dedupe_uq').on(t.taskId, t.dedupeKey), index('task_events_task_idx').on(t.taskId, t.id)],
);

export const workflowOutbox = pgTable(
  'workflow_outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: owner(),
    kind: text('kind').notNull(), // start_task | signal_approval | cancel_task | create_schedule | pause_schedule | resume_schedule | delete_schedule
    refId: text('ref_id').notNull(),
    payload: jsonb('payload').notNull().default({}),
    status: text('status').notNull().default('pending'), // pending | done | dead
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    availableAt: ts('available_at').notNull().defaultNow(),
    createdAt: created(),
    processedAt: ts('processed_at'),
  },
  (t) => [index('workflow_outbox_pending_idx').on(t.status, t.availableAt), uniqueIndex('workflow_outbox_kind_ref_uq').on(t.kind, t.refId)],
);

export const connectedAccounts = pgTable(
  'connected_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: owner(),
    toolkit: text('toolkit').notNull(),
    composioUserId: text('composio_user_id').notNull(),
    composioConnectedAccountId: text('composio_connected_account_id').unique(),
    authConfigId: text('auth_config_id'),
    status: text('status').notNull().default('initiated'), // initiated | active | expired | revoked | failed | disconnected
    accountLabel: text('account_label'),
    grantedScopes: jsonb('granted_scopes').$type<string[]>(),
    lastVerifiedAt: ts('last_verified_at'),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index('connected_accounts_owner_idx').on(t.ownerId, t.toolkit)],
);

export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: owner(),
    kind: text('kind').notNull(), // code | browser
    scope: text('scope').notNull(), // 'user' for reusable code workspace, task id for disposable browser
    templateId: text('template_id').notNull(),
    sandboxId: text('sandbox_id').unique(),
    state: text('state').notNull().default('creating'), // creating | running | paused | killed | lost | failed
    leaseHolder: text('lease_holder'),
    leaseExpiresAt: ts('lease_expires_at'),
    lastActiveAt: ts('last_active_at'),
    activeMsTotal: bigint('active_ms_total', { mode: 'number' }).notNull().default(0),
    lastError: text('last_error'),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [uniqueIndex('workspaces_owner_kind_scope_uq').on(t.ownerId, t.kind, t.scope)],
);

export const artifacts = pgTable(
  'artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: owner(),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    /** Set for files the user uploaded into a chat (and for run outputs, via the task). */
    chatId: uuid('chat_id').references(() => chats.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    objectKey: text('object_key').notNull().unique(),
    source: jsonb('source').notNull().default({}),
    createdAt: created(),
    expiresAt: ts('expires_at').notNull(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [index('artifacts_owner_idx').on(t.ownerId, t.createdAt)],
);

export const memories = pgTable(
  'memories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: owner(),
    content: text('content').notNull(),
    provenance: jsonb('provenance').notNull().default({}),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index('memories_owner_idx').on(t.ownerId)],
);

export const actionIntents = pgTable(
  'action_intents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: owner(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    toolCallId: text('tool_call_id').notNull().unique(),
    toolSlug: text('tool_slug').notNull(),
    toolVersion: text('tool_version').notNull(),
    connectedAccountId: uuid('connected_account_id').references(() => connectedAccounts.id),
    args: jsonb('args').notNull(),
    destination: jsonb('destination').notNull().default({}),
    attachments: jsonb('attachments').notNull().default([]),
    argsHash: text('args_hash').notNull(),
    nonce: text('nonce').notNull(),
    status: text('status').notNull().default('pending_approval'), // pending_approval | approved | rejected | expired | consumed
    expiresAt: ts('expires_at').notNull(),
    createdAt: created(),
  },
  (t) => [index('action_intents_owner_idx').on(t.ownerId, t.status)],
);

export const approvals = pgTable('approvals', {
  id: uuid('id').primaryKey().defaultRandom(),
  intentId: uuid('intent_id')
    .notNull()
    .unique()
    .references(() => actionIntents.id, { onDelete: 'cascade' }),
  ownerId: owner(),
  decision: text('decision').notNull(), // approved | rejected
  argsHash: text('args_hash').notNull(),
  nonce: text('nonce').notNull(),
  decidedAt: created(),
});

export const actionAttempts = pgTable('action_attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  intentId: uuid('intent_id')
    .notNull()
    .unique()
    .references(() => actionIntents.id, { onDelete: 'cascade' }),
  ownerId: owner(),
  state: text('state').notNull().default('in_flight'), // in_flight | confirmed | failed | unknown
  workerId: text('worker_id').notNull(),
  receipt: jsonb('receipt'),
  error: text('error'),
  startedAt: created(),
  finishedAt: ts('finished_at'),
});

/** Versioned rate registry. Prices are decimal strings in `currency` per `unit`. */
export const rates = pgTable(
  'rates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').notNull(),
    item: text('item').notNull(),
    unit: text('unit').notNull(),
    price: text('price').notNull(),
    currency: text('currency').notNull().default('USD'),
    source: text('source').notNull(),
    effectiveDate: text('effective_date').notNull(),
    version: text('version').notNull(),
    createdAt: created(),
  },
  (t) => [uniqueIndex('rates_version_item_uq').on(t.provider, t.item, t.unit, t.version)],
);

export const usageEntries = pgTable(
  'usage_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: owner(),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    kind: text('kind').notNull(), // model | e2b | composio | temporal
    provider: text('provider').notNull(),
    model: text('model'),
    requestId: text('request_id'),
    dedupeKey: text('dedupe_key').notNull().unique(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    cacheReadTokens: integer('cache_read_tokens'),
    cacheWriteTokens: integer('cache_write_tokens'),
    quantity: text('quantity'),
    costNanos: bigint('cost_nanos', { mode: 'bigint' }),
    costStatus: text('cost_status').notNull(), // measured | estimated | unknown
    currency: text('currency').notNull().default('USD'),
    rateVersion: text('rate_version'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: created(),
  },
  (t) => [index('usage_owner_created_idx').on(t.ownerId, t.createdAt)],
);

export const budgetReservations = pgTable(
  'budget_reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: owner(),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    dedupeKey: text('dedupe_key').notNull().unique(),
    amountNanos: bigint('amount_nanos', { mode: 'bigint' }).notNull(),
    actualNanos: bigint('actual_nanos', { mode: 'bigint' }),
    status: text('status').notNull().default('reserved'), // reserved | settled | released
    createdAt: created(),
    settledAt: ts('settled_at'),
  },
  (t) => [index('budget_owner_created_idx').on(t.ownerId, t.createdAt)],
);

export const deletionRequests = pgTable('deletion_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: owner(),
  scope: text('scope').notNull(), // task | artifact | memory | all
  refId: text('ref_id'),
  status: text('status').notNull().default('pending'),
  residual: jsonb('residual').notNull().default([]),
  createdAt: created(),
  completedAt: ts('completed_at'),
});

export const nowSql = sql`now()`;
