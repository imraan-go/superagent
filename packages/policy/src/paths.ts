import { posix } from 'node:path';

export const WORKSPACE_ROOT = '/home/user/workspace';

const ALLOWED_EXTENSIONS: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.py': 'text/x-python',
  '.js': 'text/javascript',
  '.ts': 'text/plain',
  '.html': 'text/html',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.pdf': 'application/pdf',
  '.xml': 'application/xml',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.log': 'text/plain',
};

export type PathCheck = { ok: true; absolute: string; relative: string; contentType: string } | { ok: false; reason: string };

/** Resolves a model-supplied relative path inside the workspace root, rejecting traversal. */
export function checkWorkspacePath(input: string): PathCheck {
  if (typeof input !== 'string' || input.length === 0 || input.length > 255) return { ok: false, reason: 'path must be 1-255 characters' };
  // eslint-disable-next-line no-control-regex
  if (input.includes('\0') || /[\\\u0000-\u001f]/.test(input)) return { ok: false, reason: 'path contains control characters or backslashes' };
  if (input.startsWith('/') || input.startsWith('~')) return { ok: false, reason: 'path must be relative to the workspace' };
  const normalized = posix.normalize(input);
  if (normalized.startsWith('..') || normalized.split('/').includes('..')) return { ok: false, reason: 'path traversal is not allowed' };
  if (normalized.split('/').some((seg) => seg.startsWith('.'))) return { ok: false, reason: 'hidden files and directories are not allowed' };
  const ext = posix.extname(normalized).toLowerCase();
  const contentType = ALLOWED_EXTENSIONS[ext];
  if (!contentType) return { ok: false, reason: `extension ${ext || '(none)'} is not allowed` };
  const absolute = posix.join(WORKSPACE_ROOT, normalized);
  if (!absolute.startsWith(`${WORKSPACE_ROOT}/`)) return { ok: false, reason: 'path escapes the workspace' };
  return { ok: true, absolute, relative: normalized, contentType };
}

export function safeArtifactName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'artifact';
}
