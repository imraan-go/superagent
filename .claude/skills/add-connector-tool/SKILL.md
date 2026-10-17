---
name: add-connector-tool
description: Adds a verified Composio connector tool (and, if needed, a new toolkit) that the agent can offer, with policy classification, exact approval for writes, the discovery lock, tests and the capability matrix. Use when adding or changing a Notion/Slack/Gmail/Outlook/Google/GitHub tool, or enabling a new Composio app for the agent.
---

# Add a verified connector tool

Reference commit: `git show fc42d37` (Notion, Slack, Sheets, Docs, Outlook). Read
`packages/policy/CLAUDE.md` and `packages/connectors/CLAUDE.md` first. There is no per-tool
execution code: reads run through `runConnectorRead` (`packages/activities/src/tools.ts`) and
writes through `executeApprovedAction` (`packages/activities/src/actions.ts`), driven by the catalogue.

1. **New toolkit only** (skip for a toolkit that already exists):
   - Add the slug to `ConnectorToolkit` in `packages/contracts/src/index.ts` (shared by
     `ConnectRequest`, `packages/connectors` and the catalogue).
   - Add `COMPOSIO_AUTH_CONFIG_<TOOLKIT>` to `EnvSchema` and to the map in `composioAuthConfigs()`
     in `packages/config/src/index.ts`, to `.env.example`, and to `ALLOWED` in
     `scripts/set-secret.ts`.
   - Check `PRIORITY_TOOLKITS` in `apps/api/src/composio/catalog.ts` (Connect Apps order) and
     `CONNECTED_TOOLKITS` in `apps/web/src/components/chat/parts/tool-meta.ts` (UI category).

2. **Add the candidate** to `CONNECTOR_CANDIDATES` in `packages/policy/src/connector-catalog.ts`:
   - `slug`: the exact Composio slug; `toolkit`; a `description` the model will read.
   - `schema`: a `.strict()` `z.object` with only the parameters you deliberately allow, with
     bounds (`max`, `min`, enums, `z.literal(...)` to pin dangerous options, e.g. Sheets
     `valueInputOption: z.literal('RAW')`). Parameter names must match Composio's input names.
   - `classification`: `'read'` for reads of the user's own data; `'external_write'` for anything
     that sends, creates, appends, inserts, updates or deletes outside the app. Writes say "requires
     the user's exact approval" in the description.
   - `destinationFields` (writes only): the fields that say where the write goes (recipient,
     channel, parent, document id). They are shown in the approval card and bound into the hash.

3. **Verify and lock** against the real Composio project (needs `COMPOSIO_API_KEY`;
   `pnpm setup:secret COMPOSIO_API_KEY`):

       pnpm composio:discover

   It rewrites `packages/policy/src/connector-catalog.lock.json` (slug, toolkit, version, params)
   and `.local/composio-discovery.json`. A `SKIP` line means the tool is not offered: fix the slug or
   curated params and rerun. Review the lock diff; unrelated `verifiedAt`/`version` bumps are normal.
   Without a key, you cannot lock the tool, and it stays hidden (`verifiedConnectorTools`).

4. **Tests**:
   - `packages/policy/test/policy.test.ts` already checks every candidate (strict schema, write slugs
     classified `external_write`, destination fields exist). Add a case if the schema pins values.
   - `packages/activities/test/activities.test.ts`: for a write, add the slug to the test `LOCK` and a
     test that the proposal returns `needs_approval`, no connector call happens before approval,
     `intent.destination` is right, and after `decideIntent` it executes once with the exact args
     and bound account (see the Slack and Sheets tests).
   - New toolkit: update the `supportedToolkits()` expectation and the connect loop in
     `apps/api/test/api.test.ts`.

       pnpm vitest run --project unit packages/policy packages/activities apps/api packages/connectors

5. **Docs**: add a row per tool to the table in `docs/composio-matrix.md` (toolkit, slug, class,
   curated parameters, gate) and adjust its notes; update `docs/architecture.md` "Tool surface" if a
   new class of tool appears; `docs/credentials-checklist.md` for a new auth config key.

6. Live check (optional, owner's go-ahead for any real write): connect the app in the web UI and
   run a read task. Never perform a real send without the owner's explicit approval of that message.

7. Run `pnpm check` (format, lint, typecheck, unit tests) and update README.md, `docs/` or the relevant
   `CLAUDE.md` if behavior changed.
