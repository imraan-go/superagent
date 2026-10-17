# Web app (chat, questions, routines, apps, workspaces)

The web app (`apps/web`) is the dashboard UI: a chat workspace with a Mission rail, Connect Apps,
Settings and a Workspaces view. It talks only to the API (`apps/api`) through the same-origin
`/api/*` rewrite; server components call the API with the caller's cookies (`src/server/api.ts`).

## Chats and runs

- A **chat** (`chats`) is a conversation. Its visible turns live in `chat_messages` (user turns, one
  assistant turn per finished run, and system notes such as "Routine … is running").
- Each user turn that does work is one **task** (`tasks.chat_id`), i.e. one `agentTaskWorkflow`
  run. The chat's earlier turns are copied into the new task's model messages as plain text
  (`chatHistoryForModel`: bounded by turns and characters, with a note of the tools each earlier
  turn actually used). Tool traffic stays with the run that produced it.
- When a run finishes, `finalizeTask` posts its turn to the chat once (`dedupe_key final:<taskId>`):
  tool calls with results, questions with answers, files, then the final text.
- The UI streams a run from `GET /api/runs/:id/events`, which translates `task_events` into the
  UI's run frames (`apps/api/src/run-events.ts`). The SSE id is the event id, so reconnects resume
  exactly. A chat with a run in progress reports `activeRunId`; the view re-attaches on load.

## Questions in chat (`ask_user`) and confirm gates

- The agent has an `ask_user` tool: `single`, `multi`, `confirm` or `text`. The question is stored
  in `questions` and shown as a card in the transcript and in the Inbox.
- The workflow waits **durably** (`condition` + timer, `APPROVAL_EXPIRY_HOURS`): no compute while
  waiting, and it survives deploys and worker restarts.
- Answering writes the answer to Postgres and queues a `signal_question` outbox row in one
  transaction; the reconciler sends the `questionAnswered` signal (question id only). The workflow
  re-reads the persisted answer, so a forged or duplicate signal cannot answer anything.
- Typing in the composer while a question waits answers it (for a Yes/No question, a reply that
  does not clearly say yes counts as no).
- Tools marked `confirm` (creating, pausing, resuming or deleting a routine) open a Yes/No
  question automatically; only an explicit Yes lets the call run.

## Routines from chat

- Agent tools `schedule_create`, `schedule_list`, `schedule_pause`, `schedule_resume` and
  `schedule_delete` use the same repository functions as the Schedules API
  (`createScheduleWithOutbox`, `transitionSchedule`), so chat and Settings cannot drift.
- A routine created in chat records `schedules.chat_id`; each run posts a "Routine … is running"
  note and its answer into that chat. Routines are read-only, never overlap (SKIP) and cannot
  create or change routines themselves.
- Pausing, resuming or deleting from Settings leaves a note in the routine's chat.

## Browsing domains and capability chips

- The browser opens only a run's approved domains: the owner's defaults (Settings → Agent →
  Browsing) plus sites named in the owner's own message. Text the agent reads can never add more.
- Composer chips (Workspace, Browser, Apps, Memory) **narrow** the tools offered to a run when set
  manually (`tasks.capabilities`, enforced in `exposedTools` and again in `evaluateProposal`).
  Auto leaves the run unrestricted. Questions and routines are always available.

## Connect Apps

- The modal browses the whole Composio catalog (cached server-side with the installation key).
- An app can be connected only when the agent has verified tools for it (curated in
  `packages/policy/src/connector-catalog.ts`, verified by `pnpm composio:discover`). Others show
  "Not yet". Connecting uses the per-user, ownership-verified Connect Link flow; the OAuth return
  lands back on the app's page in the modal.

## Workspaces view (`/manage`)

- **Overview**: configured capabilities and whether the worker is draining the outbox.
- **Sandboxes**: the owner's E2B workspaces. Pause and Destroy are queued to the worker
  (`workspace_pause` / `workspace_kill` outbox rows) and refused while a run is using them.
- **Activity**: tool calls across runs. **Inbox**: pending questions and approvals.
  **Routines**: the Schedules list.

## API map (added for the web app)

| Route | Purpose |
|---|---|
| `GET/POST /api/chats`, `GET/PATCH/DELETE /api/chats/:id` | Chats (owner-scoped) |
| `POST /api/chats/:id/messages` | A user turn: starts a run, or answers a waiting question |
| `POST /api/chats/:id/answer` | Answer a question card (option ids and/or text) |
| `GET /api/chats/:id/files`, `GET /api/chats/:id/screens` | Files and browser screenshots in a chat |
| `GET /api/runs/:id/events`, `POST /api/runs/:id/cancel` | Run stream (SSE) and cancel |
| `POST /api/uploads`, `GET /api/uploads/:id` | Chat attachments (validated by content) and file bytes |
| `GET /api/models` | The installation's model allowlist |
| `GET/PUT /api/settings/:section` | Preferences (appearance, sound, notifications, agent, usage, manage) |
| `GET /api/tools` | What the agent can do here (read-only) |
| `GET /api/usage/live`, `/api/usage/report`, `/api/usage/export` | Usage ticker, report, CSV |
| `GET /api/capabilities`, `/api/inbox`, `/api/activity`, `/api/workspaces` | Shell status, inbox, activity, sandboxes |
| `POST /api/workspaces/:id/pause`, `/kill` | Queue a sandbox operation |
| `/api/connectors/composio[...]` | Apps: status, connect/disconnect, catalog, app detail, logos |
