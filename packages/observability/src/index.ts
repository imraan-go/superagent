export * from './money';

const SENSITIVE_KEY = /(api[_-]?key|token|secret|password|passwd|authorization|cookie|set-cookie|private[_-]?key|session[_-]?url|mcp[_-]?url|cdp|vnc|credential|access[_-]?key)/i;

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g, 'Bearer [REDACTED]'],
  [/\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED_KEY]'],
  [/\b(vck|e2b|ak|uak|oak)_[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_KEY]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[REDACTED_KEY]'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, '[REDACTED_KEY]'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]'],
  [/([?&](?:token|access_token|key|sig|signature|code)=)[^&\s]+/gi, '$1[REDACTED]'],
  [/\bwss?:\/\/[^\s"']*devtools[^\s"']*/gi, '[REDACTED_CDP_URL]'],
];

export function redactString(input: string, maxLength = 4000): string {
  let out = input;
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep);
  if (out.length > maxLength) out = `${out.slice(0, maxLength)}…[truncated ${out.length - maxLength} chars]`;
  return out;
}

/** Deep-redacts values for logs and persisted events. Never mutates the input. */
export function redact(value: unknown, depth = 0, maxString = 4000): unknown {
  if (depth > 8) return '[depth-limit]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value, maxString);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Error) return { name: value.name, message: redactString(value.message, 1000) };
  if (value instanceof Uint8Array) return `[binary ${value.byteLength} bytes]`;
  if (Array.isArray(value)) return value.slice(0, 100).map((v) => redact(v, depth + 1, maxString));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? '[REDACTED]' : redact(v, depth + 1, maxString);
    }
    return out;
  }
  return String(value);
}

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(component: string, minLevel: Level = (process.env.LOG_LEVEL as Level) || 'info') {
  const emit = (level: Level, msg: string, fields?: Record<string, unknown>) => {
    if (ORDER[level] < ORDER[minLevel]) return;
    const line = JSON.stringify({ t: new Date().toISOString(), level, component, msg: redactString(msg, 1000), ...(fields ? (redact(fields) as object) : {}) });
    (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(`${line}\n`);
  };
  return {
    debug: (m: string, f?: Record<string, unknown>) => emit('debug', m, f),
    info: (m: string, f?: Record<string, unknown>) => emit('info', m, f),
    warn: (m: string, f?: Record<string, unknown>) => emit('warn', m, f),
    error: (m: string, f?: Record<string, unknown>) => emit('error', m, f),
  };
}
export type Logger = ReturnType<typeof createLogger>;
