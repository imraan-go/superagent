import "server-only";

/**
 * Minimal structured logger (IMPLEMENTATION_PLAN §6).
 *
 * Secrets, tokens and full tool payloads must never be passed in. Fields are
 * emitted as JSON so journald/docker logs stay greppable.
 */
type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const threshold =
  LEVELS[(process.env.LOG_LEVEL as Level | undefined) ?? "info"] ?? LEVELS.info;

/** Keys that must never be logged even if a caller passes them by mistake. */
const REDACT = /token|secret|password|authorization|api[_-]?key|cookie/i;

function emit(level: Level, scope: string, fields: Record<string, unknown> = {}) {
  if (LEVELS[level] < threshold) return;

  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    safe[key] = REDACT.test(key) ? "[redacted]" : value;
  }

  const line = JSON.stringify({
    t: new Date().toISOString(),
    level,
    scope,
    ...safe,
  });

  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const logger = {
  debug: (scope: string, fields?: Record<string, unknown>) => emit("debug", scope, fields),
  info: (scope: string, fields?: Record<string, unknown>) => emit("info", scope, fields),
  warn: (scope: string, fields?: Record<string, unknown>) => emit("warn", scope, fields),
  error: (scope: string, fields?: Record<string, unknown>) => emit("error", scope, fields),
};
