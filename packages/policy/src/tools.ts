import { z } from 'zod';

/**
 * App-owned classification. Provider/MCP annotations are never trusted on their own.
 * - read: reads the owner's own data (requires ownership of the account/workspace)
 * - app_write: creates new app-owned data inside the user's workspace/artifact store
 * - sandbox_exec: runs code inside the user's isolated E2B code sandbox (no app secrets present)
 * - browser_read: navigation/reading/screenshot of approved public destinations
 * - browser_interact: clicks/typing/scrolling that may cause page side effects
 * - external_write: changes something outside the app (email, calendar, sharing, uploads); exact approval
 * - blocked: not available until a dedicated approval/takeover path exists
 */
export type ToolClass = 'read' | 'app_write' | 'sandbox_exec' | 'browser_read' | 'browser_interact' | 'external_write' | 'blocked';
export type Executor = 'local' | 'workspace' | 'browser' | 'connector';

export interface ToolSpec<S extends z.ZodType = z.ZodType> {
  name: string;
  version: string;
  description: string;
  classification: ToolClass;
  executor: Executor;
  schema: S;
  /** Connector-only: Composio toolkit + slug. */
  toolkit?: string;
  composioSlug?: string;
  requires: Array<'e2b_code' | 'e2b_browser' | 'composio' | 'storage'>;
  /**
   * The workflow asks the user a Yes/No question in chat before this call runs; anything but an
   * explicit Yes refuses it. Used for routines, which spend money while nobody is watching.
   */
  confirm?: boolean;
  /** Not offered to runs started by a schedule (a routine must not create or edit routines). */
  interactiveOnly?: boolean;
}

const relPath = z.string().min(1).max(255).describe('Path relative to the workspace, e.g. reports/summary.md');

export const APP_TOOLS = {
  workspace_write_file: {
    name: 'workspace_write_file',
    version: '1',
    description: 'Create a NEW text file in your private cloud workspace. Fails if the file already exists. Then call workspace_export_file to make it downloadable.',
    classification: 'app_write',
    executor: 'workspace',
    schema: z.object({ path: relPath, content: z.string().max(200_000) }).strict(),
    requires: ['e2b_code'],
  },
  workspace_read_file: {
    name: 'workspace_read_file',
    version: '1',
    description: 'Read a text file from your private cloud workspace (first 20k characters).',
    classification: 'read',
    executor: 'workspace',
    schema: z.object({ path: relPath }).strict(),
    requires: ['e2b_code'],
  },
  workspace_run_python: {
    name: 'workspace_run_python',
    version: '1',
    description: 'Run a short Python 3 script inside the isolated cloud workspace (cwd is the workspace root; no internet by default). Returns stdout/stderr (truncated). Use for calculations and generating files.',
    classification: 'sandbox_exec',
    executor: 'workspace',
    schema: z.object({ code: z.string().min(1).max(20_000) }).strict(),
    requires: ['e2b_code'],
  },
  workspace_export_file: {
    name: 'workspace_export_file',
    version: '1',
    description: 'Export a workspace file to durable storage so the user can download it. Returns an artifact id.',
    classification: 'app_write',
    executor: 'workspace',
    schema: z.object({ path: relPath }).strict(),
    requires: ['e2b_code', 'storage'],
  },
  browser_navigate: {
    name: 'browser_navigate',
    version: '1',
    description: "Open a URL in the task's cloud Google Chrome browser. Only the task's approved domains are reachable.",
    classification: 'browser_read',
    executor: 'browser',
    schema: z.object({ url: z.string().url().max(2000) }).strict(),
    requires: ['e2b_browser'],
  },
  browser_read: {
    name: 'browser_read',
    version: '1',
    description: 'Read the current page: URL, title, visible text (truncated) and numbered interactive elements.',
    classification: 'browser_read',
    executor: 'browser',
    schema: z.object({}).strict(),
    requires: ['e2b_browser'],
  },
  browser_screenshot: {
    name: 'browser_screenshot',
    version: '1',
    description: 'Capture a screenshot of the current page, saved as a downloadable artifact and shown to you.',
    classification: 'browser_read',
    executor: 'browser',
    schema: z.object({ fullPage: z.boolean().default(false) }).strict(),
    requires: ['e2b_browser', 'storage'],
  },
  browser_click: {
    name: 'browser_click',
    version: '1',
    description: 'Click an interactive element by its number from browser_read. Form submissions are blocked.',
    classification: 'browser_interact',
    executor: 'browser',
    schema: z.object({ element: z.number().int().min(0).max(500) }).strict(),
    requires: ['e2b_browser'],
  },
  browser_type: {
    name: 'browser_type',
    version: '1',
    description: 'Type text into a search/text input by element number. Does not press Enter or submit. Never type personal data or credentials.',
    classification: 'browser_interact',
    executor: 'browser',
    schema: z.object({ element: z.number().int().min(0).max(500), text: z.string().max(500) }).strict(),
    requires: ['e2b_browser'],
  },
  browser_scroll: {
    name: 'browser_scroll',
    version: '1',
    description: 'Scroll the current page up or down by roughly one screen.',
    classification: 'browser_interact',
    executor: 'browser',
    schema: z.object({ direction: z.enum(['up', 'down']) }).strict(),
    requires: ['e2b_browser'],
  },
  browser_download: {
    name: 'browser_download',
    version: '1',
    description: 'Download a public file (pdf/csv/txt/json/png/jpg, max 10MB) from an approved domain into durable storage.',
    classification: 'browser_read',
    executor: 'browser',
    schema: z.object({ url: z.string().url().max(2000) }).strict(),
    requires: ['e2b_browser', 'storage'],
  },
  browser_stop: {
    name: 'browser_stop',
    version: '1',
    description: 'Close the browser session when you are done browsing.',
    classification: 'browser_read',
    executor: 'browser',
    schema: z.object({}).strict(),
    requires: ['e2b_browser'],
  },
  ask_user: {
    name: 'ask_user',
    version: '1',
    description:
      'Ask the user a question in the chat and wait for the answer. Use when a choice is genuinely theirs: kind "single" (pick one option), "multi" (pick several), "confirm" (yes/no) or "text" (free reply). Give 2-6 short options for single/multi. The user may also type a reply instead of picking. Do not ask about things you can find out yourself.',
    classification: 'app_write',
    executor: 'local',
    schema: z
      .object({
        question: z.string().trim().min(1).max(500),
        kind: z.enum(['single', 'multi', 'text', 'confirm']),
        options: z
          .array(z.object({ id: z.string().trim().min(1).max(40), label: z.string().trim().min(1).max(200) }))
          .max(8)
          .default([]),
      })
      .strict(),
    requires: [],
  },
  schedule_create: {
    name: 'schedule_create',
    version: '1',
    description:
      'Create a routine that runs a prompt on a schedule and posts results into this chat. Give either a 5-field cron expression or everyMinutes (>= 5). Routines run read-only. The user is asked to confirm before it is created.',
    classification: 'app_write',
    executor: 'local',
    schema: z
      .object({
        name: z.string().trim().min(1).max(120),
        prompt: z.string().trim().min(1).max(4000).describe('What each run should do, written as an instruction to yourself'),
        cron: z.string().trim().min(9).max(120).optional(),
        everyMinutes: z.number().int().min(5).max(60 * 24 * 7).optional(),
        timezone: z.string().trim().max(64).optional().describe('IANA timezone; defaults to the user timezone'),
      })
      .strict()
      .refine((v) => Boolean(v.cron) !== Boolean(v.everyMinutes), 'give exactly one of cron or everyMinutes'),
    requires: [],
    confirm: true,
    interactiveOnly: true,
  },
  schedule_list: {
    name: 'schedule_list',
    version: '1',
    description: "List the user's routines with their ids, timing and state.",
    classification: 'read',
    executor: 'local',
    schema: z.object({}).strict(),
    requires: [],
    interactiveOnly: true,
  },
  schedule_pause: {
    name: 'schedule_pause',
    version: '1',
    description: 'Pause a routine by id (from schedule_list). The user is asked to confirm.',
    classification: 'app_write',
    executor: 'local',
    schema: z.object({ id: z.uuid() }).strict(),
    requires: [],
    confirm: true,
    interactiveOnly: true,
  },
  schedule_resume: {
    name: 'schedule_resume',
    version: '1',
    description: 'Resume a paused routine by id (from schedule_list). The user is asked to confirm.',
    classification: 'app_write',
    executor: 'local',
    schema: z.object({ id: z.uuid() }).strict(),
    requires: [],
    confirm: true,
    interactiveOnly: true,
  },
  schedule_delete: {
    name: 'schedule_delete',
    version: '1',
    description: 'Delete a routine by id (from schedule_list). The user is asked to confirm.',
    classification: 'app_write',
    executor: 'local',
    schema: z.object({ id: z.uuid() }).strict(),
    requires: [],
    confirm: true,
    interactiveOnly: true,
  },
  memory_save: {
    name: 'memory_save',
    version: '1',
    description: 'Save a short durable note about the user\'s stated preferences. The user can view, edit and delete it.',
    classification: 'app_write',
    executor: 'local',
    schema: z.object({ content: z.string().min(1).max(500) }).strict(),
    requires: [],
  },
} satisfies Record<string, ToolSpec>;

export type AppToolName = keyof typeof APP_TOOLS;

export interface PolicyContext {
  readOnly: boolean;
  configured: Set<string>;
  connectorActive: (toolkit: string) => boolean;
}

export type PolicyDecision = { verdict: 'allow' } | { verdict: 'deny'; reason: string } | { verdict: 'needs_approval' };

export function evaluateTool(spec: ToolSpec, ctx: PolicyContext): PolicyDecision {
  for (const r of spec.requires) if (!ctx.configured.has(r)) return { verdict: 'deny', reason: `${r} is not configured on this installation` };
  if (spec.executor === 'connector') {
    if (!spec.toolkit || !ctx.connectorActive(spec.toolkit)) return { verdict: 'deny', reason: `no active ${spec.toolkit} connection owned by this user` };
  }
  switch (spec.classification) {
    case 'read':
    case 'app_write':
    case 'sandbox_exec':
    case 'browser_read':
    case 'browser_interact':
      return { verdict: 'allow' };
    case 'external_write':
      if (ctx.readOnly) return { verdict: 'deny', reason: 'this task is read-only; external changes are not permitted' };
      return { verdict: 'needs_approval' };
    case 'blocked':
    default:
      return { verdict: 'deny', reason: `${spec.name} is blocked until its approval/takeover path exists` };
  }
}
