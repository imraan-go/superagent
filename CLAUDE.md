# CLAUDE.md

Guidance for Claude Code sessions working in this repository. Project overview, layout and setup
live in [README.md](README.md).

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

### 2. Keep docs, skills and memory current

Update documentation in the same piece of work as the change it describes:

- `README.md` and `docs/` when setup, commands, layout or behavior change.
- Skill files (`.claude/skills/`) when a workflow they describe changes.
- `CLAUDE.md` and Claude memory files when a rule or convention changes.

Before wrapping up, check whether anything you changed is described somewhere and update it.
