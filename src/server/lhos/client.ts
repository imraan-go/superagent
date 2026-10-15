import "server-only";
import { env } from "@/server/env";
import { AppError } from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";
import {
  approvalDecisionSchema,
  approvalListSchema,
  capabilitiesSchema,
  eventListSchema,
  toolCatalogSchema,
  toolResultSchema,
} from "./types";
import type {
  Capabilities,
  LhosEvent,
  PendingApproval,
  ToolBlock,
  ToolDef,
  ToolResult,
} from "./types";
import {
  backoffMs,
  classifyFailure,
  MAX_TRANSPORT_RETRIES,
  isRetryable,
} from "./retryable";

/**
 * The single typed gateway to the LHOS agent server (rule 20-api-mcp).
 *
 * Tool execution goes over REST rather than the MCP SDK (ADR-01): identical
 * tool surface, a typed envelope that already carries `ok` and server-measured
 * `ms`, and no session lifecycle to manage.
 *
 * Every response is zod-parsed. Nothing here ever reaches the browser — the
 * bearer token stays server-side.
 */

/** Tool calls can legitimately run long; `ask_user` blocks up to 110 s. */
const TOOL_TIMEOUT_MS = 120_000;
const READ_TIMEOUT_MS = 15_000;

export interface LhosRequestOptions {
  signal?: AbortSignal | undefined;
  timeoutMs?: number | undefined;
}

interface FetchJsonArgs extends LhosRequestOptions {
  path: string;
  method?: "GET" | "POST";
  body?: unknown;
  /** Idempotent reads are retried on transport/5xx failures; writes are not. */
  retries?: number;
  /** Returns raw text instead of JSON (used by /api/report). */
  raw?: boolean;
}

function url(path: string): string {
  return `${env.LHOS_BASE_URL.replace(/\/$/, "")}${path}`;
}

function authHeaders(): HeadersInit {
  return {
    authorization: `Bearer ${env.LHOS_MCP_TOKEN}`,
    accept: "application/json",
  };
}

/**
 * Combines the caller's abort signal with a timeout, so cancelling a run aborts
 * the in-flight LHOS call too (skill-agent-loop §Gotchas).
 */
function withTimeout(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`LHOS request timed out after ${timeoutMs}ms`)),
    timeoutMs,
  );

  const onAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", onAbort, { once: true });
  }

  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

function toAppErrorFor(path: string, status: number | undefined, message: string): AppError {
  const kind = classifyFailure({ status, message });
  if (kind === "waking") {
    return new AppError(
      "computer_waking",
      "The computer is waking up. Retrying shortly.",
      { detail: { path, upstream: message } },
    );
  }
  if (kind === "unavailable") {
    return new AppError("lhos_unavailable", "The agent server is unreachable.", {
      detail: { path, status, upstream: message },
    });
  }
  return new AppError("tool_failed", message, { detail: { path, status } });
}

async function fetchJson<T>(
  args: FetchJsonArgs,
  parse: (value: unknown) => T,
): Promise<T> {
  const {
    path,
    method = "GET",
    body,
    retries = 0,
    raw = false,
    signal,
    timeoutMs = READ_TIMEOUT_MS,
  } = args;

  let lastError: AppError | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const started = Date.now();
    const { signal: combined, done } = withTimeout(signal, timeoutMs);

    try {
      const response = await fetch(url(path), {
        method,
        headers:
          body === undefined
            ? authHeaders()
            : { ...authHeaders(), "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: combined,
        cache: "no-store",
      });

      const ms = Date.now() - started;
      const text = await response.text();

      if (!response.ok) {
        // Error bodies are `{error: "..."}`; fall back to the raw text.
        let message = text.slice(0, 500);
        try {
          const parsed: unknown = JSON.parse(text);
          if (parsed && typeof parsed === "object" && "error" in parsed) {
            message = String((parsed as { error: unknown }).error);
          }
        } catch {
          /* not JSON — keep the raw text */
        }
        throw toAppErrorFor(path, response.status, message);
      }

      logger.debug("lhos", { path, ms, ok: true });
      return parse(raw ? text : (JSON.parse(text) as unknown));
    } catch (err) {
      const appErr =
        err instanceof AppError
          ? err
          : toAppErrorFor(path, undefined, err instanceof Error ? err.message : String(err));

      lastError = appErr;
      logger.warn("lhos", {
        path,
        ms: Date.now() - started,
        ok: false,
        code: appErr.code,
      });

      // Caller-initiated cancellation must not be retried.
      if (signal?.aborted) throw appErr;

      const kind = classifyFailure({ message: appErr.message });
      if (attempt < retries && isRetryable(kind)) {
        await sleep(backoffMs(kind, attempt));
        continue;
      }
      throw appErr;
    } finally {
      done();
    }
  }

  throw lastError ?? new AppError("internal", "LHOS request failed");
}

function sleep(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));
}

/* ------------------------------------------------------------- client -- */

export interface LhosClient {
  getTools(options?: LhosRequestOptions): Promise<ToolDef[]>;
  callTool(name: string, args: Record<string, unknown>, options?: LhosRequestOptions): Promise<ToolResult>;
  getCapabilities(options?: LhosRequestOptions): Promise<Capabilities>;
  getEvents(params?: { date?: string; limit?: number }, options?: LhosRequestOptions): Promise<LhosEvent[]>;
  getReport(date?: string, options?: LhosRequestOptions): Promise<string>;
  getPendingApprovals(options?: LhosRequestOptions): Promise<PendingApproval[]>;
  decideApproval(id: string, decision: "approve" | "reject"): Promise<{ ok: boolean; answer?: string | undefined }>;
}

export const lhos: LhosClient = {
  /** 43 KB document, no pagination — cache it (ADR-06). */
  getTools(options) {
    return fetchJson({ path: "/api/tools", retries: MAX_TRANSPORT_RETRIES, ...options }, (v) =>
      toolCatalogSchema.parse(v),
    );
  },

  callTool(name, args, options) {
    if (!/^[A-Za-z0-9_]+$/.test(name)) {
      throw new AppError("bad_request", `Invalid tool name: ${name}`);
    }
    // Never retried: tool calls are not idempotent (rule 20-api-mcp).
    return fetchJson(
      {
        path: `/api/tools/${name}`,
        method: "POST",
        body: args,
        timeoutMs: TOOL_TIMEOUT_MS,
        retries: 0,
        ...options,
      },
      (v) => toolResultSchema.parse(v),
    );
  },

  getCapabilities(options) {
    return fetchJson({ path: "/api/capabilities", retries: MAX_TRANSPORT_RETRIES, ...options }, (v) =>
      capabilitiesSchema.parse(v),
    );
  },

  getEvents(params, options) {
    const qs = new URLSearchParams();
    if (params?.date) qs.set("date", params.date);
    if (params?.limit) qs.set("limit", String(params.limit));
    const suffix = qs.size ? `?${qs.toString()}` : "";
    return fetchJson(
      { path: `/api/events${suffix}`, retries: MAX_TRANSPORT_RETRIES, ...options },
      (v) => eventListSchema.parse(v),
    );
  },

  getReport(date, options) {
    const suffix = date ? `?date=${encodeURIComponent(date)}` : "";
    return fetchJson(
      { path: `/api/report${suffix}`, raw: true, retries: MAX_TRANSPORT_RETRIES, ...options },
      (v) => String(v),
    );
  },

  getPendingApprovals(options) {
    return fetchJson({ path: "/api/approvals", retries: MAX_TRANSPORT_RETRIES, ...options }, (v) =>
      approvalListSchema.parse(v),
    );
  },

  /**
   * Approve/reject a `confirm` checkpoint. Uses APPROVE_TOKEN, which is
   * human-only: this function must only ever be reached from a route guarded
   * by the owner's session, and never from the agent loop
   * (rule 30-security, skill-approvals-hitl).
   *
   * The agent server rejects any record whose kind is not `confirm` with 404;
   * `ask`/`takeover` are answered through the Manage host bridge (ADR-02).
   */
  async decideApproval(id, decision) {
    if (!/^[0-9a-f]{8}$/.test(id)) {
      throw new AppError("bad_request", "Malformed approval id.");
    }

    const target = `${env.LHOS_BASE_URL.replace(/\/$/, "")}/approvals/${id}/${decision}?token=${encodeURIComponent(env.LHOS_APPROVE_TOKEN)}`;
    const { signal, done } = withTimeout(undefined, READ_TIMEOUT_MS);

    try {
      const response = await fetch(target, { method: "POST", signal, cache: "no-store" });
      const text = await response.text();

      if (!response.ok) {
        if (response.status === 404) {
          throw new AppError(
            "not_found",
            "That approval is no longer pending, or is not a confirm checkpoint.",
          );
        }
        // Never echo the URL back — it contains the token.
        throw new AppError("lhos_unavailable", "The approvals service rejected the decision.", {
          detail: { status: response.status },
        });
      }

      return approvalDecisionSchema.parse(JSON.parse(text));
    } finally {
      done();
    }
  },
};

/**
 * Block helpers. These take the `result` array rather than the whole envelope
 * so they compose with blocks assembled from several calls.
 */

/** Concatenated text blocks — what the model sees as the tool's output. */
export function resultText(blocks: ToolBlock[]): string {
  return blocks
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

/** Image blocks, for persisting to the files volume (ADR-07). */
export function resultImages(
  blocks: ToolBlock[],
): Array<{ mime: string; data_b64: string }> {
  return blocks.filter(
    (b): b is { type: "image"; mime: string; data_b64: string } => b.type === "image",
  );
}
