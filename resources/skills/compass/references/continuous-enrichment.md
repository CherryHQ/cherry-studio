# Continuous Agent Graph enrichment

Load this reference after the user explicitly enables continuous overlay
enrichment for the current coding session. It turns the one-shot Agent Graph
workflow into a bounded loop while keeping ordinary Compass navigation and the
source-derived Base Graph read-only.

## Contract and state machine

Use these states in the assistant's session context:

```text
READ_ONLY
   └─ explicit user opt-in ─▶ PINNED
PINNED ─▶ COLLECTING ─▶ READY_TO_FLUSH ─▶ APPLIED ─▶ COLLECTING
   │             │                 │
   └─ Base change┴─────────────────┴─▶ REBASE_REQUIRED
REBASE_REQUIRED ─▶ REBASE_REVIEW ─▶ PINNED
COLLECTING ─▶ CLOSED (deferred candidates are reported)
```

`PINNED` stores the canonical project root, Base Generation, Overlay ID,
active Overlay Revision, composition profile, and write scope. `COLLECTING`
stores only a bounded candidate ledger: stable assertion key, intended CRUD
operation, endpoint identities, source spans or exact Base references, and a
short evidence summary. A conversation claim without a verifiable citation is
not a candidate for durable knowledge. Never store prompts, chain-of-thought,
credentials, or unrelated private data in the overlay audit trail.

## Milestone loop

At orientation, after a durable design decision, before a commit, and before
closing the session:

1. Query the exact pinned Effective Graph and remove candidates already present.
   Use the current assertion ID and digest for updates or retractions; never
   create a duplicate because a label looks different.
2. Move only source-cited candidates to `READY_TO_FLUSH`. Keep batches bounded
   by the active Agent Graph limits; flush before the candidate ledger or
   request approaches a limit. Separate unrelated source spans when preparing
   evidence.
3. Run `compass agent-graph prepare` for the exact Base nodes, edges, and
   repository-relative byte spans. Copy its Base Generation, expected
   revision, references, and grounding submission into a strict
   `compass.agent-graph.batch/1` request. Do not hand-edit Compass digests or
   add a certificate/status field.
4. Apply only with explicit local or MCP write authority. Treat the operation
   as all-or-nothing. Record the receipt, audit it, inspect the revision diff,
   and replace the pinned revision with the receipt's revision before the next
   query or batch. Reusing an idempotency key is safe only for identical
   content.

Use `put_assertion` for agent-owned create/replace, `retract_assertion` for an
agent-owned deletion, and `put_challenge` when the user disputes a Base fact.
Never delete a Base node or edge. A curated mask is a separate, explicitly
authorized choice and is not part of ordinary continuous enrichment.

## Source-change gate and recovery

After `compass update .`, a watch refresh, a checkout change, or any command
that reports a new Base Generation, stop collecting writes and enter
`REBASE_REQUIRED`:

```bash
compass agent-graph status --root . --graph compass-out/graph.json \
  --overlay overlay:review --format json
compass agent-graph rebase-plan --root . --graph compass-out/graph.json \
  --overlay overlay:review --revision OLD_REVISION --format json
```

Resolve every plan item. Exact identities may reattach; missing, changed, and
ambiguous targets require a newly grounded replacement, explicit retraction,
or a user decision. Submit the complete
`compass.agent-graph.rebase-commit/1` request, then pin its receipt and return
to `COLLECTING`. Do not first-match rebind, continue writes on the old Base,
or publish a partial rebase.

For `revision_conflict`, inspect status/history/diff and regenerate against the
intended exact revision. For grounding or digest failures, reread the selected
source and prepare again. For disabled authority, retain the request as a
proposal and tell the user what explicit capability is required. At close,
report the Base Generation, overlay, final revision, profile, receipts,
deferred candidates, and unresolved conflicts so the next session can resume
deterministically.

## MCP equivalent

For a local coding session, configure a canonical project allowlist and use the
read-only `inspect_agent_graph` preparation before drafting a batch. Enable
`apply_agent_graph` only for the requested write scope; HTTP additionally needs
distinct read and write credentials. The server chooses principal, scope,
limits, and expiry. Keep the same pinned-revision, milestone, audit, and
rebase gates as the CLI workflow.
