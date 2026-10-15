# Skill: token & cost metering (live ticker)

**Goal:** right-sidebar top shows live tokens in/out + running cost (this chat / today),
with a sortable usage view in Settings.

## Steps
1. Adapters return normalized usage per completion: `{in, out, cached, vendor, model}`
   (Anthropic: input_tokens/output_tokens/cache_read_input_tokens; OpenAI Responses:
   usage.input_tokens/output_tokens; OpenRouter: usage + their generation endpoint
   when absent).
2. Price it: `pricing.ts` reads config/models.json (per-1M rates, cached-input rate);
   settings can override per model. Write `usage_events` row inside the same
   transaction as the message persist.
3. Ticker: `/api/usage/live` SSE pushes `{chatTokens, chatCost, dayTokens, dayCost}`
   after every event; Readout components count-up on change. Also push LHOS tool-call
   counts (events feed) so "actions" sits next to tokens.
4. Settings → Usage: table grouped by day/vendor/model/chat; sort any column;
   CSV export; danger-zone "reset counters" only archives (no delete).

## Gotchas
- Streamed completions: usage arrives at stream end — tick UI with estimates
  (chars/4) flagged `~`, replace with exact on final.
- numeric(12,6) for USD; display `$0.0042` style, mono, tabular-nums.
- Daily rollup matview refreshed on write (trigger) — the ticker never full-scans.
