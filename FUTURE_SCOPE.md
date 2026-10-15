# Future scope (not now — park ideas here)

- **Multi-user / team mode:** schema is ready (users table); add roles, per-user
  usage, shared chats. Only if the owner ever wants collaborators.
- **Voice:** push-to-talk input (Whisper/realtime API) + spoken summaries.
- **Mobile PWA:** installable, push notifications (replace Chrome-only notifs),
  approval-from-phone fast path.
- **E2B cloud portability:** MODE=cloud switch exists server-side; panel needs a
  backend picker + support for shorter sandbox lifetimes (pause/resume UX).
- **Set-of-marks RDP vision:** numbered-overlay screenshots for precise RDP clicks
  (discussed; not built server-side yet).
- **Server-side autonomous loops:** long-running background agents with budgets +
  daily digest (currently every run is owner-initiated or scheduled).
- **Workflow visual editor:** drag-drop step builder over LHOS workflow_save.
- **Artifacts pane:** render agent-produced HTML/react mini-apps in a sandboxed
  iframe (like Claude artifacts) with version history.
- **Local model support:** Ollama/vLLM adapter for cheap classification tasks.
- **Cost optimizer:** auto-route steps to cheaper models by task type; cache common
  tool results (capabilities, profiles) across runs.
- **Secondary agent computers:** multiple sandboxes/profiles, fleet view in Manage.
- **Browser extension:** "send this page/task to my agent" + approval shortcuts.
- **Audit & replay:** full run replay viewer (step-through with screenshots timeline).
- **Panel-native RAG:** drop PDFs/docs into a knowledge library (pgvector) the agent
  cites from.
