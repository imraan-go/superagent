# Skill: build/modify the agent orchestration loop

**Goal:** server-side plan→act→observe loop streaming to the UI, with approvals.

## Steps
1. Fetch tool defs once per run: `lhos.getTools()` → filter by settings allowlist →
   map JSON-Schema to the vendor adapter's tool format.
2. Context assembly order: system prompt (settings.agent.system) + capability facts
   (`/api/capabilities`, compact) + memory recall (pgvector topK=8 over the user
   message) + last N chat messages + current run steps.
3. Call `ModelAdapter.stream()` — forward text deltas as SSE `token`; on tool_call:
   persist `run_steps` row (status running) → `POST /api/tools/<name>` → persist
   result (trim >8KB, store full in files/) → feed tool_result back to the model.
4. Checkpoints: if tool name matches approval policy regex (send|post|publish|pay|
   delete|trash|submit) OR LHOS returns `awaiting_approval` → status
   `paused_approval`, emit `approval_required`, STOP the loop. Resume endpoint
   re-enters at step 3 with the decision appended.
5. `request_takeover`/`ask_user` from the model → emit `takeover_requested`/question
   event, poll `hitl_check` every 5s until answered, continue.
6. End: emit `usage` totals + `done`; run memory-extraction (small/cheap model) →
   upsert `memories`.

## Gotchas
- Abort controller per run; cancel endpoint must abort both model stream and any
  in-flight LHOS call.
- max_steps (settings, default 40) and max_cost_usd guard (default $2/run) — stop
  with a clear `error` event, never silently.
- Images in tool results: save to files/, send the model a short reference + (if
  vision model) the image block; never re-send old screenshots every turn — keep
  only the latest 2 in context.
- Desktop "recreating" errors are retryable (30 s, max 4) — emit a `waiting` step.
