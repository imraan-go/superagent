# CLAUDE.md

Guidance for Claude Code sessions working in this repository. Project overview, layout and setup
live in [README.md](README.md). Each app and package has its own short `CLAUDE.md` with its local
rules; read it before editing there.

## Workflow rules

### 1. Every code change has a ClickUp ticket

Work is tracked in the ClickUp **Superagent** space (lists: Active, Backlog, Bugs, Future Scope).
Before changing any code:

1. Search ClickUp for tickets related to the change.
2. If a matching ticket is in **to do** or **backlog**, pick it up. Otherwise create a new ticket in
   the **Active** list that describes the change.
3. Assign the ticket to the current user and set its status to **in progress**.
4. Only then start the change. Link the ticket in commit/PR descriptions and in your replies.

When the work is committed and waiting for review, move the ticket to **ready to review**.

Don't move tickets to **shipped** or **cancelled** yourself: when a PR closes, the ClickUp sync
workflow moves every ticket the PR links (`https://app.clickup.com/t/<id>` or `CU-<id>`) to
**shipped** if it merged, or **cancelled** if it didn't. Link only the tickets the PR finishes;
name other tickets by title or ID without a link.

### 2. Keep docs, skills and memory current

Update documentation in the same piece of work as the change it describes:

- `README.md` and `docs/` when setup, commands, layout or behavior change.
- The package's `CLAUDE.md` when one of its rules or its allowed dependencies change.
- Skill files (`.claude/skills/`) when a workflow they describe changes.
- `docs/decisions/` when you make or reverse an architectural decision.
- This file and Claude memory files when a rule or convention changes.

Before wrapping up, check whether anything you changed is described somewhere and update it.

### 3. Done means `pnpm check` passes

- `pnpm check:changed` while iterating: Prettier, ESLint, typecheck and unit/web tests, scoped to
  what changed since the branch left `main`. A Stop hook runs it automatically when there are
  uncommitted changes.
- `pnpm check` before committing: the same on the whole repo; CI runs it on every PR.
- `pnpm test:integration` when touching workflows, the worker, the outbox or schedules (needs the
  `temporal` CLI; no Docker).
- One package's tests: `pnpm vitest run --project unit packages/<name>`.

Do not weaken a lint rule, skip a test or add `any` to get a check passing; fix the cause or ask.

## Conventions

- Formatting is Prettier (`.prettierrc.json`); a PostToolUse hook formats every file you edit.
- Package boundaries are lint rules: source may only import the `@superagent/*` packages its
  `package.json` declares, and workflows may only import `contracts`. Add a dependency only when it
  fits the layering in [docs/architecture.md](docs/architecture.md).
- Model calls go through the Vercel AI Gateway only (`openai`/`@ai-sdk/*` direct imports are lint errors).
- Tests live in `<package>/test/<source-file>.test.ts`; integration tests end in `.int.test.ts`.
  Unit tests are hermetic: no network, Docker or real keys.
- Never read, print or commit `.env`; add new keys to `.env.example` and `docs/credentials-checklist.md`.

## Skills

Use the project skills in `.claude/skills/` for these tasks: `add-migration`, `add-connector-tool`,
`add-workflow-activity`, `local-debug`.
