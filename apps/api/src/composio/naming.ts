/**
 * Namespacing for non-LHOS tools exposed to the agent loop. Pure module.
 *
 *   composio__<app>__<action>   Composio connected-app actions
 *   mcp__<server>__<tool>       remote MCP servers
 *   pipedream__emit             outbound Pipedream event
 *
 * Vendor tool-name rules are the tightest common denominator:
 * `^[a-zA-Z0-9_-]{1,64}$`. Names are slugged and clipped to fit; the original
 * identifiers are kept in the registry so clipping never loses routing.
 */
export const TOOL_NAME_MAX = 64;
export type ToolNamespace = 'composio' | 'mcp' | 'pipedream';

export function slug(part: string): string {
  return (
    part
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/_{2,}/g, '_')
      .replace(/^_+|_+$/g, '') || 'x'
  );
}

export function namespacedTool(ns: ToolNamespace, group: string, action?: string): string {
  const name = action === undefined ? `${ns}__${slug(group)}` : `${ns}__${slug(group)}__${slug(action)}`;
  return name.slice(0, TOOL_NAME_MAX);
}

export function parseNamespaced(name: string): { ns: ToolNamespace; group: string; action: string | null } | null {
  const m = /^(composio|mcp|pipedream)__([a-z0-9_]+?)(?:__([a-z0-9_]+))?$/.exec(name);
  if (!m) return null;
  return { ns: m[1] as ToolNamespace, group: m[2]!, action: m[3] ?? null };
}

export function isExternalToolName(name: string): boolean {
  return parseNamespaced(name) !== null;
}

/**
 * Read/write classification of a Composio action slug (the part after the
 * toolkit prefix, any case: `FETCH_EMAILS`, `fetch_emails`). A tool counts as
 * read-only only when it starts with a read verb AND no token anywhere in the
 * slug is a write verb (`get_or_create_x` is a write). Unknown verbs are NOT
 * read-only, which makes the approval gate and the default tool selection
 * fail closed.
 */
const READ_VERBS = new Set([
  'get',
  'list',
  'fetch',
  'search',
  'find',
  'read',
  'query',
  'retrieve',
  'check',
  'describe',
  'lookup',
  'view',
  'count',
  'show',
  'browse',
  'resolve',
  'verify',
  'preview',
]);
const WRITE_TOKENS = new Set([
  'send',
  'post',
  'publish',
  'submit',
  'reply',
  'comment',
  'create',
  'update',
  'edit',
  'add',
  'insert',
  'append',
  'set',
  'modify',
  'patch',
  'put',
  'move',
  'copy',
  'rename',
  'upload',
  'write',
  'delete',
  'remove',
  'trash',
  'archive',
  'clear',
  'share',
  'invite',
  'forward',
  'cancel',
  'approve',
  'reject',
  'merge',
  'push',
  'deploy',
  'pay',
  'transfer',
  'revoke',
  'grant',
  'label',
  'unlabel',
  'mark',
  'star',
  'pin',
  'follow',
  'unfollow',
  'like',
  'react',
  'schedule',
  'reschedule',
  'import',
  'run',
  'execute',
  'trigger',
  'start',
  'stop',
  'enable',
  'disable',
  'assign',
  'tag',
  'untag',
  'undelete',
  'restore',
  'empty',
  'drop',
  'purge',
]);

export function isComposioReadAction(action: string): boolean {
  const tokens = action
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (tokens[0] === 'batch') tokens.shift(); // batch_get, batch_read
  const first = tokens[0];
  if (!first || !READ_VERBS.has(first)) return false;
  return !tokens.slice(1).some((t) => WRITE_TOKENS.has(t));
}

/** `GMAIL_FETCH_EMAILS` + `gmail` → `fetch_emails` (what the model sees after `composio__gmail__`). */
export function composioActionName(toolSlug: string, toolkit: string): string {
  return slug(toolSlug.replace(new RegExp(`^${toolkit.replace(/[^a-z0-9]/gi, '.?')}_`, 'i'), ''));
}
