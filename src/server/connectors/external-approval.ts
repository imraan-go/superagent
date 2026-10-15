import { requiresApproval } from "@/server/agent/policy";
import type { ApprovalDecision } from "@/server/agent/policy";

export const PIPEDREAM_EMIT = "pipedream__emit";

/**
 * Approval decision for external tools: the default policy (send/post/delete…)
 * plus `pipedream__emit`, which always leaves the box.
 */
export function externalApproval(
  name: string,
  opts: { extraPatterns?: readonly string[]; args?: Record<string, unknown> } = {},
): ApprovalDecision {
  const base = requiresApproval(name, { extraPatterns: opts.extraPatterns ?? [] }, opts.args);
  if (base.required) return base;
  if (name === PIPEDREAM_EMIT) return { required: true, reason: "emits an event to an external system" };
  return base;
}
