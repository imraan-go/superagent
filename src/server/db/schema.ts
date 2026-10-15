import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Schema per docs/ARCHITECTURE.md §Database.
 *
 * Single-owner product, but every owned row still carries `user_id` so the
 * schema stays multi-tenant-ready (README §Golden rules 3).
 */

/* ---------------------------------------------------------------- enums -- */

export const runStatus = pgEnum("run_status", [
  "running",
  "paused_approval",
  "paused_question",
  "done",
  "error",
  "cancelled",
]);

export const stepType = pgEnum("step_type", [
  "think",
  "tool",
  "observe",
  "approval",
  "takeover",
  "waiting",
]);

export const messageRole = pgEnum("message_role", ["user", "assistant", "system", "tool"]);

/** HITL kinds as the LHOS server reports them (IMPLEMENTATION_PLAN ADR-02). */
export const approvalKind = pgEnum("approval_kind", ["confirm", "ask", "takeover"]);

export const approvalStatus = pgEnum("approval_status", [
  "pending",
  "approved",
  "rejected",
  "answered",
  "expired",
]);

/** Where the decision was made — the owner may also answer on the LHOS page. */
export const decidedVia = pgEnum("decided_via", ["panel", "lhos-page", "desktop"]);

export const fileOrigin = pgEnum("file_origin", ["upload", "tool"]);

export const memoryKind = pgEnum("memory_kind", ["fact", "preference", "project"]);

export const connectorKind = pgEnum("connector_kind", ["composio", "pipedream", "custom"]);

/* ---------------------------------------------------------------- users -- */

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passHash: text("pass_hash").notNull(),
  totpSecret: text("totp_secret"),
  prefs: jsonb("prefs").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

/* ---------------------------------------------------------------- chats -- */

export const chats = pgTable(
  "chats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("New chat"),
    pinned: boolean("pinned").notNull().default(false),
    archived: boolean("archived").notNull().default(false),
    model: text("model"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Sidebar ordering: pinned first, then most recent.
    index("chats_user_updated_idx").on(t.userId, t.updatedAt.desc()),
    index("chats_pinned_idx").on(t.userId, t.pinned),
  ],
);

/**
 * `content` is an array of parts (text / image / tool_use / tool_result) so one
 * row holds a complete multimodal turn.
 */
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chatId: uuid("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    runId: uuid("run_id"),
    role: messageRole("role").notNull(),
    content: jsonb("content").$type<unknown[]>().notNull(),
    model: text("model"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("messages_chat_created_idx").on(t.chatId, t.createdAt)],
);

/* ----------------------------------------------------------------- runs -- */

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chatId: uuid("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    status: runStatus("status").notNull().default("running"),
    model: text("model").notNull(),
    error: text("error"),
    /** Monotonic SSE sequence allocator for this run (see runEvents). */
    lastSeq: integer("last_seq").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [index("runs_chat_started_idx").on(t.chatId, t.startedAt.desc())],
);

export const runSteps = pgTable(
  "run_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    type: stepType("type").notNull(),
    toolName: text("tool_name"),
    args: jsonb("args"),
    /** Trimmed at 8 KB; the full payload lands in `files` (skill-agent-loop). */
    result: jsonb("result"),
    images: uuid("images").array().notNull().default(sql`'{}'::uuid[]`),
    ms: integer("ms"),
    ok: boolean("ok"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("run_steps_run_idx_unique").on(t.runId, t.idx)],
);

/**
 * Append-only SSE event log (IMPLEMENTATION_PLAN ADR-05). `runs` + `run_steps`
 * cannot reconstruct a token-level stream, so a client reconnecting with
 * `Last-Event-ID` replays `seq > N` from here before attaching to the live
 * stream.
 */
export const runEvents = pgTable(
  "run_events",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    data: jsonb("data").notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("run_events_run_seq_unique").on(t.runId, t.seq)],
);

/* ---------------------------------------------------------------- usage -- */

export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    vendor: text("vendor").notNull(),
    model: text("model").notNull(),
    chatId: uuid("chat_id").references(() => chats.id, { onDelete: "set null" }),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    tokensCached: integer("tokens_cached").notNull().default(0),
    /** USD with 6 decimals — display as $0.0042 (skill-token-metering). */
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    /** chat | memory-extraction | title-gen | … */
    purpose: text("purpose").notNull().default("chat"),
  },
  (t) => [
    index("usage_events_ts_idx").on(t.ts.desc()),
    index("usage_events_chat_idx").on(t.chatId, t.ts.desc()),
    index("usage_events_model_idx").on(t.vendor, t.model),
  ],
);

/* ------------------------------------------------------------ approvals -- */

export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** 8-hex id from GET /api/approvals; null for panel-policy checkpoints. */
    lhosApprovalId: text("lhos_approval_id"),
    kind: approvalKind("kind").notNull(),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "cascade" }),
    stepIdx: integer("step_idx"),
    prompt: text("prompt").notNull(),
    status: approvalStatus("status").notNull().default("pending"),
    answer: text("answer"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedVia: decidedVia("decided_via"),
  },
  (t) => [
    uniqueIndex("approvals_lhos_id_unique").on(t.lhosApprovalId),
    index("approvals_status_idx").on(t.status, t.createdAt.desc()),
  ],
);

/* ---------------------------------------------------------------- files -- */

export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sha256: text("sha256").notNull(),
    name: text("name").notNull(),
    mime: text("mime").notNull(),
    bytes: integer("bytes").notNull(),
    /** Path on the uploads volume, outside the web root (rule 30-security). */
    path: text("path").notNull(),
    chatId: uuid("chat_id").references(() => chats.id, { onDelete: "set null" }),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
    origin: fileOrigin("origin").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("files_sha256_unique").on(t.sha256),
    index("files_chat_idx").on(t.chatId),
  ],
);

/* ------------------------------------------------------------- settings -- */

/** Validated against config/settings.schema.json before every write. */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Vendor/connector credentials, AES-256-GCM sealed with PANEL_SECRET_KEY.
 * The UI shows `last4` only; there is deliberately no reveal endpoint.
 */
export const secrets = pgTable("secrets", {
  name: text("name").primaryKey(),
  enc: text("enc").notNull(),
  last4: text("last4").notNull(),
  vendor: text("vendor"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const connectors = pgTable("connectors", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: connectorKind("kind").notNull(),
  name: text("name").notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Mirrors LHOS `schedule_*`; LHOS stays the source of truth, this is UI cache. */
export const schedules = pgTable("schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  lhosId: text("lhos_id"),
  cron: text("cron").notNull(),
  workflow: text("workflow"),
  /** Panel-native schedules run an agent prompt instead of an LHOS workflow. */
  prompt: text("prompt"),
  enabled: boolean("enabled").notNull().default(true),
  lastRun: timestamp("last_run", { withTimezone: true }),
  nextRun: timestamp("next_run", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------- memories -- */

export const memories = pgTable(
  "memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: memoryKind("kind").notNull().default("fact"),
    text: text("text").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
    sourceChat: uuid("source_chat").references(() => chats.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("memories_embedding_hnsw").using(
      "hnsw",
      t.embedding.op("vector_cosine_ops"),
    ),
  ],
);

/* ---------------------------------------------------------------- audit -- */

/** Every mutating Manage action lands here (docs/MANAGE_TAB.md §Host bridge). */
export const audit = pgTable(
  "audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    who: text("who").notNull().default("owner"),
    action: text("action").notNull(),
    detail: jsonb("detail"),
    ok: boolean("ok").notNull(),
    result: text("result"),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_ts_idx").on(t.ts.desc())],
);

/* ------------------------------------------------------- login attempts -- */

/** Backs the 5-fails-per-15-minutes login limiter (rule 30-security). */
export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ip: text("ip").notNull(),
    ok: boolean("ok").notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("login_attempts_ip_ts_idx").on(t.ip, t.ts.desc())],
);

/* ------------------------------------------------------- tool catalogue -- */

/** 5-minute server-side cache of GET /api/tools (43 KB, no pagination). */
export const toolCache = pgTable("tool_cache", {
  id: text("id").primaryKey(),
  tools: jsonb("tools").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  latencyMs: real("latency_ms"),
});
