import type { ConnectorToolkit } from '@superagent/contracts';
import { z } from 'zod';
import lock from './connector-catalog.lock.json' with { type: 'json' };
import type { ToolClass, ToolSpec } from './tools';

/**
 * Curated connector candidates. Each exposes only the parameters we deliberately allow.
 * A candidate is offered to the model only after `pnpm composio:discover` has verified the
 * slug exists for this Composio project, recorded its toolkit version, and confirmed every
 * curated parameter is present in the live schema (see connector-catalog.lock.json).
 */
interface Candidate {
  toolkit: ConnectorToolkit;
  slug: string;
  classification: ToolClass;
  description: string;
  schema: z.ZodObject;
  /** Fields that identify where an external write goes, shown prominently in the approval preview. */
  destinationFields?: string[];
}

export const CONNECTOR_CANDIDATES: Candidate[] = [
  {
    toolkit: 'github',
    slug: 'GITHUB_GET_THE_AUTHENTICATED_USER',
    classification: 'read',
    description: "Get the connected GitHub account's profile.",
    schema: z.object({}).strict(),
  },
  {
    toolkit: 'github',
    slug: 'GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER',
    classification: 'read',
    description: 'List repositories the connected GitHub user can access.',
    schema: z
      .object({
        per_page: z.number().int().min(1).max(50).optional(),
        sort: z.enum(['created', 'updated', 'pushed', 'full_name']).optional(),
      })
      .strict(),
  },
  {
    toolkit: 'googlecalendar',
    slug: 'GOOGLECALENDAR_EVENTS_LIST',
    classification: 'read',
    description: "List events from the user's primary Google Calendar in a time range (RFC3339 timeMin/timeMax).",
    schema: z
      .object({
        calendarId: z.literal('primary').default('primary'),
        timeMin: z.string().max(40).optional(),
        timeMax: z.string().max(40).optional(),
        maxResults: z.number().int().min(1).max(50).optional(),
        singleEvents: z.boolean().optional(),
        orderBy: z.enum(['startTime', 'updated']).optional(),
      })
      .strict(),
  },
  {
    toolkit: 'googledrive',
    slug: 'GOOGLEDRIVE_FIND_FILE',
    classification: 'read',
    description: "Search the user's Google Drive files by name/query (metadata only).",
    schema: z
      .object({ q: z.string().max(500).optional(), pageSize: z.number().int().min(1).max(25).optional() })
      .strict(),
  },
  {
    toolkit: 'gmail',
    slug: 'GMAIL_FETCH_EMAILS',
    classification: 'read',
    description: 'Search/read recent Gmail messages with a Gmail query (e.g. "is:unread newer_than:2d").',
    schema: z
      .object({ query: z.string().max(300).optional(), max_results: z.number().int().min(1).max(10).optional() })
      .strict(),
  },
  {
    toolkit: 'gmail',
    slug: 'GMAIL_CREATE_EMAIL_DRAFT',
    classification: 'external_write',
    description: "Create a Gmail draft in the user's account (requires the user's exact approval).",
    schema: z
      .object({ recipient_email: z.string().email(), subject: z.string().max(300), body: z.string().max(20_000) })
      .strict(),
    destinationFields: ['recipient_email'],
  },
  {
    toolkit: 'gmail',
    slug: 'GMAIL_SEND_EMAIL',
    classification: 'external_write',
    description:
      "Send an email from the user's Gmail (requires the user's exact approval of recipient, subject and body).",
    schema: z
      .object({ recipient_email: z.string().email(), subject: z.string().max(300), body: z.string().max(20_000) })
      .strict(),
    destinationFields: ['recipient_email'],
  },
  {
    toolkit: 'notion',
    slug: 'NOTION_SEARCH_NOTION_PAGE',
    classification: 'read',
    description: 'Search Notion pages or databases the connected workspace shared with the integration, by title.',
    schema: z
      .object({
        query: z.string().max(300).optional(),
        filter_value: z.enum(['page', 'database']).optional(),
        page_size: z.number().int().min(1).max(25).optional(),
      })
      .strict(),
  },
  {
    toolkit: 'notion',
    slug: 'NOTION_GET_PAGE_MARKDOWN',
    classification: 'read',
    description: 'Read a Notion page as Markdown by page id.',
    schema: z.object({ page_id: z.string().min(1).max(100) }).strict(),
  },
  {
    toolkit: 'notion',
    slug: 'NOTION_QUERY_DATABASE',
    classification: 'read',
    description: 'List rows of a Notion database by database id.',
    schema: z
      .object({ database_id: z.string().min(1).max(100), page_size: z.number().int().min(1).max(50).optional() })
      .strict(),
  },
  {
    toolkit: 'notion',
    slug: 'NOTION_CREATE_NOTION_PAGE',
    classification: 'external_write',
    description: "Create a Notion page under a parent page with Markdown content (requires the user's exact approval).",
    schema: z
      .object({
        parent_id: z.string().min(1).max(100),
        title: z.string().min(1).max(300),
        markdown: z.string().max(20_000).optional(),
      })
      .strict(),
    destinationFields: ['parent_id', 'title'],
  },
  {
    toolkit: 'slack',
    slug: 'SLACK_LIST_ALL_CHANNELS',
    classification: 'read',
    description: 'List Slack channels in the connected workspace (names and ids).',
    schema: z
      .object({ limit: z.number().int().min(1).max(200).optional(), exclude_archived: z.boolean().optional() })
      .strict(),
  },
  {
    toolkit: 'slack',
    slug: 'SLACK_FETCH_CONVERSATION_HISTORY',
    classification: 'read',
    description:
      'Read recent messages from a Slack channel by channel id (optional Unix-timestamp oldest/latest bounds).',
    schema: z
      .object({
        channel: z.string().min(1).max(100),
        limit: z.number().int().min(1).max(50).optional(),
        oldest: z.string().max(40).optional(),
        latest: z.string().max(40).optional(),
      })
      .strict(),
  },
  {
    toolkit: 'slack',
    slug: 'SLACK_SEARCH_MESSAGES',
    classification: 'read',
    description: 'Search Slack messages with Slack search syntax (e.g. "in:#general from:@ana budget").',
    schema: z.object({ query: z.string().min(1).max(300), count: z.number().int().min(1).max(20).optional() }).strict(),
  },
  {
    toolkit: 'slack',
    slug: 'SLACK_SEND_MESSAGE',
    classification: 'external_write',
    description:
      "Post a Markdown message to a Slack channel or thread (requires the user's exact approval of channel and text).",
    schema: z
      .object({
        channel: z.string().min(1).max(100),
        markdown_text: z.string().min(1).max(12_000),
        thread_ts: z.string().max(40).optional(),
      })
      .strict(),
    destinationFields: ['channel', 'thread_ts'],
  },
  {
    toolkit: 'googlesheets',
    slug: 'GOOGLESHEETS_SEARCH_SPREADSHEETS',
    classification: 'read',
    description: "Find spreadsheets in the user's Google Drive by name (metadata only).",
    schema: z
      .object({ query: z.string().max(300).optional(), max_results: z.number().int().min(1).max(25).optional() })
      .strict(),
  },
  {
    toolkit: 'googlesheets',
    slug: 'GOOGLESHEETS_VALUES_GET',
    classification: 'read',
    description: 'Read cell values from a Google Sheet range in A1 notation (e.g. "Sheet1!A1:D50").',
    schema: z.object({ spreadsheet_id: z.string().min(1).max(100), range: z.string().min(1).max(200) }).strict(),
  },
  {
    toolkit: 'googlesheets',
    slug: 'GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND',
    classification: 'external_write',
    description:
      "Append rows to a Google Sheet table; values are stored as typed, never evaluated as formulas (requires the user's exact approval).",
    schema: z
      .object({
        spreadsheetId: z.string().min(1).max(100),
        range: z.string().min(1).max(200),
        values: z
          .array(z.array(z.union([z.string().max(2000), z.number(), z.boolean(), z.null()])).max(50))
          .min(1)
          .max(200),
        valueInputOption: z.literal('RAW').default('RAW'),
      })
      .strict(),
    destinationFields: ['spreadsheetId', 'range'],
  },
  {
    toolkit: 'googledocs',
    slug: 'GOOGLEDOCS_SEARCH_DOCUMENTS',
    classification: 'read',
    description: "Search the user's Google Docs by name or content (metadata only).",
    schema: z
      .object({ query: z.string().max(300).optional(), max_results: z.number().int().min(1).max(25).optional() })
      .strict(),
  },
  {
    toolkit: 'googledocs',
    slug: 'GOOGLEDOCS_GET_DOCUMENT_PLAINTEXT',
    classification: 'read',
    description: 'Read a Google Doc as plain text by document id.',
    schema: z.object({ document_id: z.string().min(1).max(200) }).strict(),
  },
  {
    toolkit: 'googledocs',
    slug: 'GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN',
    classification: 'external_write',
    description: "Create a new Google Doc from Markdown in the user's Drive (requires the user's exact approval).",
    schema: z.object({ title: z.string().min(1).max(300), markdown_text: z.string().max(50_000).optional() }).strict(),
    destinationFields: ['title'],
  },
  {
    toolkit: 'googledocs',
    slug: 'GOOGLEDOCS_INSERT_TEXT_ACTION',
    classification: 'external_write',
    description: "Append text to the end of an existing Google Doc (requires the user's exact approval).",
    schema: z
      .object({
        document_id: z.string().min(1).max(200),
        text_to_insert: z.string().min(1).max(20_000),
        append_to_end: z.literal(true).default(true),
      })
      .strict(),
    destinationFields: ['document_id'],
  },
  {
    toolkit: 'outlook',
    slug: 'OUTLOOK_LIST_MESSAGES',
    classification: 'read',
    description:
      'List recent Outlook messages, optionally full-text searched, unread-only, or received after an ISO 8601 time.',
    schema: z
      .object({
        top: z.number().int().min(1).max(10).optional(),
        search: z.string().max(300).optional(),
        is_read: z.boolean().optional(),
        received_date_time_ge: z.string().max(40).optional(),
      })
      .strict(),
  },
  {
    toolkit: 'outlook',
    slug: 'OUTLOOK_GET_CALENDAR_VIEW',
    classification: 'read',
    description: 'List Outlook calendar events between two ISO 8601 date-times (with offset).',
    schema: z
      .object({
        start_datetime: z.string().max(40),
        end_datetime: z.string().max(40),
        top: z.number().int().min(1).max(50).optional(),
      })
      .strict(),
  },
  {
    toolkit: 'outlook',
    slug: 'OUTLOOK_CREATE_DRAFT',
    classification: 'external_write',
    description: "Create an Outlook draft in the user's mailbox (requires the user's exact approval).",
    schema: z
      .object({
        to_recipients: z.array(z.string().email()).min(1).max(10),
        subject: z.string().max(300),
        body: z.string().max(20_000),
      })
      .strict(),
    destinationFields: ['to_recipients'],
  },
  {
    toolkit: 'outlook',
    slug: 'OUTLOOK_SEND_EMAIL',
    classification: 'external_write',
    description:
      "Send an email from the user's Outlook (requires the user's exact approval of recipient, subject and body).",
    schema: z.object({ to: z.string().email(), subject: z.string().max(300), body: z.string().max(20_000) }).strict(),
    destinationFields: ['to'],
  },
];

export interface LockEntry {
  toolkit: string;
  version: string;
  verifiedAt: string;
  params: string[];
}

const LOCK = lock as Record<string, LockEntry>;
export const CONNECTOR_LOCK: Readonly<Record<string, LockEntry>> = LOCK;

export function connectorToolName(slug: string): string {
  return slug.toLowerCase();
}

export interface ConnectorToolSpec extends ToolSpec {
  destinationFields: string[];
}

/** Only verified, locked candidates whose curated params are all present upstream. */
export function verifiedConnectorTools(lockOverride?: Record<string, LockEntry>): ConnectorToolSpec[] {
  const l = lockOverride ?? LOCK;
  return CONNECTOR_CANDIDATES.flatMap((c) => {
    const entry = l[c.slug];
    if (!entry || entry.toolkit !== c.toolkit) return [];
    const curated = Object.keys(c.schema.shape);
    if (!curated.every((p) => entry.params.includes(p))) return [];
    return [
      {
        name: connectorToolName(c.slug),
        version: entry.version,
        description: c.description,
        classification: c.classification,
        executor: 'connector' as const,
        schema: c.schema,
        toolkit: c.toolkit,
        composioSlug: c.slug,
        requires: ['composio' as const],
        destinationFields: c.destinationFields ?? [],
      },
    ];
  });
}
