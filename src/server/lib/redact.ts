/** Pure; shared by the logger, audit and the agent loop. */
/**
 * Removes bearer-equivalent material from text that will reach the model,
 * the run timeline or the audit log: signed/trigger/share URLs carrying a
 * token in the query, and `Bearer` header values.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(
      /([?&](?:token|access_token|auth|key|api_key|apikey|sig|signature|secret|t|k|x-amz-signature)=)[^&\s"'<>)\]]+/gi,
      "$1[redacted]",
    )
    .replace(/(\/(?:t|trigger|share|s|intake)\/)[A-Za-z0-9_-]{16,}/g, "$1[redacted]")
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1[redacted]");
}

/** Deep-redacts string values in a log/audit field. */
export function redactValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redactSecrets(value);
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactValue(v, depth + 1);
  return out;
}
