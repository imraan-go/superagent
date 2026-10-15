import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/db/schema";
import { AppError } from "@/server/lib/errors";
import { lhos, resultText } from "@/server/lhos/client";
import { MANAGED_UNITS } from "@/server/manage/bridge";
import type { ManagedUnit } from "@/server/manage/bridge";

/**
 * Shared helpers for the /api/manage routes: input parsing and audited LHOS
 * mutations. Host-side mutations are audited inside `bridge.ts`; the LHOS
 * ones (schedules, maintenance, report generation, share links) land here.
 */

const unitSchema = z.enum(MANAGED_UNITS);

export const logQuerySchema = z.object({
  n: z.coerce.number().int().min(1).max(1000).default(200),
  since: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/)
    .optional(),
});

export function parseUnit(raw: string): ManagedUnit {
  const parsed = unitSchema.safeParse(raw);
  if (!parsed.success) throw new AppError("bad_request", "Unknown or disallowed unit.");
  return parsed.data;
}

export async function parseBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    throw new AppError("bad_request", parsed.error.issues[0]?.message ?? "Invalid body.");
  }
  return parsed.data;
}

/** Runs an LHOS tool and returns its concatenated text output. */
export async function toolText(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const res = await lhos.callTool(name, args);
  const text = resultText(res.result);
  if (!res.ok) throw new AppError("tool_failed", text.slice(0, 500) || `${name} failed.`);
  return text;
}

/** Parses a tool whose text output is a JSON document. */
export async function toolJson<T>(
  name: string,
  schema: z.ZodType<T>,
  args: Record<string, unknown> = {},
): Promise<T> {
  const text = await toolText(name, args);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new AppError("tool_failed", `${name} returned a non-JSON response.`);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AppError("tool_failed", `${name} returned an unexpected shape.`);
  return parsed.data;
}

export async function recordAudit(
  action: string,
  detail: unknown,
  ok: boolean,
  result: string,
): Promise<void> {
  await db
    .insert(audit)
    .values({ action, detail: detail as object, ok, result: result.slice(0, 2000) })
    .catch(() => {});
}

/** Wraps an LHOS mutation so success and failure both leave an audit row. */
export async function auditedTool<T>(
  action: string,
  detail: unknown,
  fn: () => Promise<T>,
  /** Replaces the stored result — for outputs that must not be persisted (signed links). */
  redactedResult?: string,
): Promise<T> {
  try {
    const out = await fn();
    await recordAudit(
      action,
      detail,
      true,
      redactedResult ?? (typeof out === "string" ? out : JSON.stringify(out)),
    );
    return out;
  } catch (err) {
    await recordAudit(action, detail, false, err instanceof Error ? err.message : String(err));
    throw err;
  }
}
