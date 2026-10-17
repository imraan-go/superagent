# 5. Exact-approval hashing before anything leaves the user's account

Status: Accepted

## Context

Prompt injection in email, web pages or documents can steer the model. The app must guarantee that
nothing is sent, created or changed outside the app unless the user approved that exact action, and
that an approval cannot be replayed, forged or applied to different content.

## Decision

Tools classified `external_write` (`packages/policy/src/tools.ts`) always need approval and are
denied in read-only (scheduled) runs. Before any write, `evaluateProposal` creates an immutable
intent whose hash is `sha256(canonicalJson({v: 1, ...binding}))` (`packages/policy/src/canonical.ts`).
The binding covers owner, task, tool slug and version, connected account, arguments, destination
fields, attachments (sha256 and name), nonce and expiry. Canonical JSON sorts keys, drops
`undefined`, NFC-normalises strings and rejects non-finite numbers. The UI posts back the hash and
nonce (`ApprovalDecisionRequest`); the workflow re-reads the persisted approval after the signal
(`checkApproval`); `executeApprovedAction` runs at most once and records attempts as in flight,
confirmed, failed or unknown (`packages/activities/src/actions.ts`, `packages/db/src/repos/approvals.ts`).

## Consequences

- A changed tool version, revoked account, expiry or any field change requires a new approval.
- An unknown outcome is shown to the user and never resent automatically.
- The hashing code must stay byte-for-byte stable; changing it invalidates pending approvals.
- Policy blocks unapproved writes through known channels; it does not stop every manipulation of
  reads and summaries (residual risk).

Source: `docs/architecture.md` (Approvals).
