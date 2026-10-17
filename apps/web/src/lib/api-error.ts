/**
 * Reads an API error body. The API answers `{ error: "code", message?, issues? }` (Hono routes)
 * and Better Auth answers `{ code, message }`; older panel routes used `{ error: { code, message } }`.
 */
export function readApiError(body: unknown, status: number): { code: string; message: string; retryable: boolean } {
  const b = (body ?? {}) as Record<string, unknown>;
  const nested = typeof b.error === 'object' && b.error !== null ? (b.error as Record<string, unknown>) : null;
  const code = String(nested?.code ?? (typeof b.error === 'string' ? b.error : b.code) ?? 'internal');
  const issues = Array.isArray(b.issues) ? (b.issues as Array<{ path?: string; message?: string }>) : [];
  const message =
    (typeof nested?.message === 'string' && nested.message) ||
    (typeof b.message === 'string' && b.message) ||
    (issues.length ? issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('; ') : '') ||
    FRIENDLY[code] ||
    `Request failed (${status}).`;
  return { code, message, retryable: nested?.retryable === true || status === 429 || status === 503 };
}

const FRIENDLY: Record<string, string> = {
  unauthenticated: 'Your session has ended. Sign in again.',
  forbidden_origin: 'That request came from another site and was blocked.',
  rate_limited: 'Too many requests; wait a moment and try again.',
  setup_required: 'This feature needs setup on the server first.',
  not_found: 'Not found.',
};
