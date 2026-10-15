/**
 * Approval-decision orchestration, kept free of `fetch`/env so it is unit
 * testable. LHOS can take longer than a read timeout to answer a reject (it
 * removes the record first, then unwinds the blocked tool call), so a timeout
 * is not proof of failure: re-check the pending list and treat "record gone"
 * as success.
 */
export const DECIDE_TIMEOUT_MS = 45_000;

export interface DecideDeps {
  /** POSTs the decision; rejects with a timeout/transport error or AppError. */
  post(): Promise<{ ok: boolean; answer?: string | undefined }>;
  /** Ids of approvals still pending in LHOS. */
  listPendingIds(): Promise<string[]>;
}

export function isTimeoutError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  return /timed out|timeout|aborted/i.test(msg);
}

export async function decideWithRecheck(
  id: string,
  deps: DecideDeps,
): Promise<{ ok: boolean; answer?: string | undefined }> {
  try {
    return await deps.post();
  } catch (err) {
    if (!isTimeoutError(err)) throw err;
    let pending: string[];
    try {
      pending = await deps.listPendingIds();
    } catch {
      throw err; // cannot verify: surface the original timeout
    }
    if (!pending.includes(id)) return { ok: true };
    throw err;
  }
}
