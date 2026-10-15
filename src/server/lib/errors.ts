/**
 * Structured errors (IMPLEMENTATION_PLAN §6). Every failure carries a code the
 * UI can branch on, so the interface can show "the computer is waking up"
 * instead of a generic toast.
 */

export const ERROR_CODES = [
  "unauthorized",
  "rate_limited",
  "bad_request",
  "not_found",
  "conflict",
  /** LHOS unreachable or 5xx. */
  "lhos_unavailable",
  /** Desktop sandbox is recreating/restoring — retry in ~30 s. */
  "computer_waking",
  /** A tool ran but reported failure. */
  "tool_failed",
  /** Run hit maxSteps or maxCostUsdPerRun. */
  "budget_exceeded",
  "vendor_error",
  /** No vendor API key configured for the selected model. */
  "no_model_key",
  "internal",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const STATUS: Record<ErrorCode, number> = {
  unauthorized: 401,
  rate_limited: 429,
  bad_request: 400,
  not_found: 404,
  conflict: 409,
  lhos_unavailable: 502,
  computer_waking: 503,
  tool_failed: 502,
  budget_exceeded: 402,
  vendor_error: 502,
  no_model_key: 412,
  internal: 500,
};

const RETRYABLE: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  "lhos_unavailable",
  "computer_waking",
  "rate_limited",
]);

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly detail: Record<string, unknown> | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    options?: { cause?: unknown; detail?: Record<string, unknown> },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS[code];
    this.retryable = RETRYABLE.has(code);
    this.detail = options?.detail;
  }

  /** Safe to send to the browser — never includes `cause`. */
  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        retryable: this.retryable,
        ...(this.detail ? { detail: this.detail } : {}),
      },
    };
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/** Normalises anything thrown into an AppError without leaking internals. */
export function toAppError(e: unknown): AppError {
  if (isAppError(e)) return e;
  const message = e instanceof Error ? e.message : "Unexpected error";
  return new AppError("internal", message, { cause: e });
}
