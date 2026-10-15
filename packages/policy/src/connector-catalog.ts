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
  toolkit: 'github' | 'googlecalendar' | 'googledrive' | 'gmail' | 'notion';
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
    schema: z.object({ per_page: z.number().int().min(1).max(50).optional(), sort: z.enum(['created', 'updated', 'pushed', 'full_name']).optional() }).strict(),
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
    schema: z.object({ q: z.string().max(500).optional(), pageSize: z.number().int().min(1).max(25).optional() }).strict(),
  },
  {
    toolkit: 'gmail',
    slug: 'GMAIL_FETCH_EMAILS',
    classification: 'read',
    description: 'Search/read recent Gmail messages with a Gmail query (e.g. "is:unread newer_than:2d").',
    schema: z.object({ query: z.string().max(300).optional(), max_results: z.number().int().min(1).max(10).optional() }).strict(),
  },
  {
    toolkit: 'gmail',
    slug: 'GMAIL_CREATE_EMAIL_DRAFT',
    classification: 'external_write',
    description: "Create a Gmail draft in the user's account (requires the user's exact approval).",
    schema: z.object({ recipient_email: z.string().email(), subject: z.string().max(300), body: z.string().max(20_000) }).strict(),
    destinationFields: ['recipient_email'],
  },
  {
    toolkit: 'gmail',
    slug: 'GMAIL_SEND_EMAIL',
    classification: 'external_write',
    description: 'Send an email from the user\'s Gmail (requires the user\'s exact approval of recipient, subject and body).',
    schema: z.object({ recipient_email: z.string().email(), subject: z.string().max(300), body: z.string().max(20_000) }).strict(),
    destinationFields: ['recipient_email'],
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
