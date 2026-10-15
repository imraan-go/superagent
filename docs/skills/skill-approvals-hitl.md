# Skill: approvals & human-in-the-loop UX

**Goal:** owner must explicitly approve irreversible actions; agent can never self-approve.

## Steps
1. Sources of pending items: (a) panel policy checkpoints (run paused), (b) LHOS
   `GET /api/approvals` (workflow confirm steps), (c) `hitl_check` questions.
2. Right sidebar → Approvals card: prompt text, originating run/step link,
   Approve (signal) / Reject (danger) buttons; both write an `approvals` row with
   decided_via='panel'.
3. LHOS approvals: proxy approve/reject server-side using `APPROVE_TOKEN` from env
   — route requires owner session; token never reaches client JS. Resume the LHOS
   workflow with `start_at` + `approval_id` after approve.
4. Notify: toast + sound 'approval' + Chrome notification when tab blurred.
5. Takeover requests auto-expand the Computer panel (see skill-vnc-embed).

## Gotchas
- Poll /api/approvals only while a run is active or Manage mode open (5 s), else 60 s.
- An approval decided on the LHOS web page (not panel) must reconcile: poll sees it
  gone → mark decided_via='lhos-page'.
- Never bake auto-approve into settings; the "Approvals & Takeover" tab only tunes
  WHICH patterns checkpoint (stricter allowed, looser capped at the default list).
