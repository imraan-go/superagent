/**
 * Display formatting shared by the server (usage rows) and the client (the
 * Mission rail ticker). Kept out of `server/models/pricing.ts` so the browser
 * can use it without importing a server-only module.
 */

/** `$0.0042` — mono, tabular-nums in the UI (DESIGN_SYSTEM §Readout). */
export function formatCost(usd: number): string {
  if (!Number.isFinite(usd) || usd === 0) return '$0';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

/** Compact token counts: 1200 → 1.2k, 1_200_000 → 1.2M. */
export function formatTokens(count: number): string {
  if (count < 1_000) return String(count);
  if (count < 1_000_000) return `${(count / 1_000).toFixed(1)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}
