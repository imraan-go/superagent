import { z } from "zod";

/**
 * Wire types for the LHOS agent server, verified against the live service on
 * 2026-10-15 (docs/API_REFERENCE.md). These are the *actual* shapes, which in
 * several places differ from the original prose docs — see
 * IMPLEMENTATION_PLAN §2.
 */

/* ------------------------------------------------- POST /api/tools/<name> -- */

export const toolBlockSchema = z.union([
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("image"), mime: z.string(), data_b64: z.string() }),
  z.object({ type: z.literal("json"), data: z.unknown() }),
  // The server falls back to `{type: <python type>, data: <string>}` for any
  // block it does not recognise; accept it rather than failing the run.
  z.object({ type: z.string(), data: z.unknown() }),
]);

export type ToolBlock = z.infer<typeof toolBlockSchema>;

/** The envelope — NOT the raw tool result. */
export const toolResultSchema = z.object({
  ok: z.boolean(),
  tool: z.string(),
  /** Server-measured duration; feeds run_steps.ms and the step chips. */
  ms: z.number(),
  result: z.array(toolBlockSchema),
});

export type ToolResult = z.infer<typeof toolResultSchema>;

/** Error body for 400 (unknown tool / validation) and 500. */
export const toolErrorSchema = z.object({
  ok: z.literal(false).optional(),
  error: z.string(),
});

/* ------------------------------------------------------- GET /api/tools -- */

export const toolDefSchema = z.object({
  name: z.string(),
  // Some tools report a null description; normalise to "" so adapters that
  // require a string never see null.
  description: z
    .string()
    .nullish()
    .transform((v) => v ?? ""),
  input_schema: z.record(z.string(), z.unknown()),
});

export type ToolDef = z.infer<typeof toolDefSchema>;
export const toolCatalogSchema = z.array(toolDefSchema);

/* ------------------------------------------------ GET /api/capabilities -- */

export const capabilitiesSchema = z.looseObject({
  desktop: z.looseObject({ up: z.boolean(), sandbox_id: z.string().nullish() }).optional(),
  linux_browser: z.looseObject({ devtools_running: z.boolean().optional() }).optional(),
  rdp: z
    .looseObject({
      connected: z.boolean().optional(),
      profile: z.string().nullish(),
      shared_drive: z.boolean().optional(),
      password_stored: z.boolean().optional(),
      profiles: z.array(z.string()).optional(),
    })
    .optional(),
  api: z
    .looseObject({
      credentials: z.array(z.unknown()).optional(),
      connectors: z.array(z.unknown()).optional(),
    })
    .optional(),
  skills: z.array(z.looseObject({ name: z.string() })).optional(),
  pace: z
    .looseObject({
      mode: z.string(),
      min_gap_s: z.number().optional(),
      max_per_hour: z.number().optional(),
    })
    .optional(),
  pending_human_requests: z.number().optional(),
});

export type Capabilities = z.infer<typeof capabilitiesSchema>;

/* ------------------------------------------------------ GET /api/events -- */

export const eventSchema = z.looseObject({
  ts: z.number(),
  iso: z.string().optional(),
  tool: z.string(),
  ms: z.number().optional(),
  ok: z.boolean().optional(),
  err: z.string().nullish(),
  images: z.number().optional(),
  client: z.string().optional(),
  via: z.string().optional(),
});

export type LhosEvent = z.infer<typeof eventSchema>;
export const eventListSchema = z.array(eventSchema);

/* --------------------------------------------------- GET /api/approvals -- */

/**
 * All pending HITL records, of every kind — not only workflow confirms.
 * `confirm` is answered through the approvals proxy; `ask` and `takeover` are
 * answered through the Manage host bridge (ADR-02).
 */
export const hitlKindSchema = z.enum(["confirm", "ask", "takeover"]);
export type HitlKind = z.infer<typeof hitlKindSchema>;

export const pendingApprovalSchema = z.object({
  /** 8 hex characters. */
  id: z.string(),
  kind: hitlKindSchema.catch("confirm"),
  prompt: z
    .string()
    .nullish()
    .transform((v) => v ?? ""),
  /** Float UNIX seconds. */
  created: z.number(),
});

export type PendingApproval = z.infer<typeof pendingApprovalSchema>;
export const approvalListSchema = z.array(pendingApprovalSchema);

/** POST /approvals/{id}/approve|reject */
export const approvalDecisionSchema = z.object({
  ok: z.boolean(),
  answer: z.string().optional(),
});
