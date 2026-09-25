# Agentic coding sessions with Compass

Load this reference when a user wants an AI coding agent to initialize a
Compass-backed session, preserve verified project knowledge, enhance graph
topology, challenge a Base fact, or carry an Agent Graph Overlay across code
changes. Navigation alone remains read-only and does not need an overlay.

## What the user can ask

Users do not need to compose commands or JSON themselves. These prompts express
the intended authority and scope clearly:

- “Use Compass to initialize this coding session around authentication. Keep
  the graph read-only and show me the evidence you use.”
- “Use overlay `overlay:auth-review`. Add only source-cited GROUNDED
  enhancements that will help later sessions, and show every applied change.”
- “Query revision `REVISION` of `overlay:auth-review` while planning this
  change; do not use an implicit latest revision.”
- “Refresh the Base Graph after these edits, prepare a rebase of my overlay,
  and stop if any assertion cannot be reattached exactly.”
- “Challenge this Base relation with cited evidence. Do not mask or delete the
  Base fact.”

An instruction to analyze, navigate, or explain does not authorize overlay
writes. An instruction to add, update, retract, challenge, or enhance graph
knowledge does. Masking needs separate, explicit intent because it changes the
curated Effective Graph view.

## Initialize and pin the session

First ensure the Base Graph is current when the task requires current source:

```bash
compass update .
compass agent-graph status \
  --root . \
  --graph compass-out/graph.json \
  --overlay overlay:auth-review \
  --format json
```

Outside Git, add an absolute `--state-root`; Compass refuses to invent a
non-Git persistence location. For history, use an exact `--realization` instead
of `--graph` and repeat it on every command.

Record four selectors in session state:

1. canonical project root or exact history realization;
2. the returned Base Generation;
3. the chosen Overlay ID;
4. the active Overlay Revision, if one exists.

Do not derive these values from paths, names, or model memory. After each write,
replace the pinned revision with the revision in the receipt. Use `status` to
recover a selector after interruption, then inspect `history` or `audit` before
assuming that its active revision is the session's intended one.

## Read and compose coding context

Inspect an exact overlay before changing it:

```bash
compass agent-graph history \
  --root . --graph compass-out/graph.json \
  --overlay overlay:auth-review --format json

compass agent-graph query \
  --root . --graph compass-out/graph.json \
  --overlay overlay:auth-review \
  --revision REVISION \
  --profile augment \
  --cql 'MATCH (a)-[r]->(b) RETURN a, r, b'
```

For a focused implementation task, compose Base evidence and exact agent
knowledge together:

```bash
compass context modify TARGET \
  --root . \
  --graph compass-out/graph.json \
  --agent-overlay overlay:auth-review \
  --agent-revision REVISION \
  --agent-profile augment \
  --format json
```

The `agentKnowledge` section remains separate from Base provenance. Use
`augment` for ordinary additive knowledge. Use `curated` only when the user
intends approved masks to affect the view.

## Prepare and apply a verified change

First ask Compass to prepare the verifier-owned values:

```bash
compass agent-graph prepare \
  --root . \
  --graph compass-out/graph.json \
  --overlay overlay:auth-review \
  --base-node NODE_ID \
  --base-edge EDGE_ID \
  --source-span src/lib.rs:120:188 \
  --format json
```

Selectors are repeatable. Use only the Base facts the assertion actually
depends on, and call `prepare` separately for assertions backed by different
source spans. The response pins the Base Generation and active
`expectedRevision`, then supplies canonical Base references and an apply-ready
grounding submission. Do not calculate, edit, or reuse these digests across a
different Base Generation.

Start from `fixtures/contracts/agent-graph/batch-v1.json` and preserve its
strict `compass.agent-graph.batch/1` shape. Copy the prepared Base Generation,
Overlay ID, `expectedRevision`, Base references, and grounding submission.
Omit the expected revision only when preparation omits it. Give each logical
retry a stable idempotency key.

Every proposed assertion must carry the evidence required by its grounding
policy. Preparation is read-only and does not certify a claim; apply re-reads
and verifies its evidence. Requests cannot award themselves a Grounding
certificate or `GROUNDED` status.

Apply one bounded batch atomically:

```bash
compass agent-graph apply \
  --root . \
  --graph compass-out/graph.json \
  --overlay overlay:auth-review \
  --request change-batch.json \
  --principal principal:local \
  --enable-writes \
  --format json
```

Compass either accepts the entire batch or publishes none of it. Report the
receipt's revision, sequence, operation counts, and batch digest. Reusing the
same idempotency key with identical content returns the prior receipt; reusing
it with different content is a conflict.

## Map intent to CRUD operations

Use the narrowest operation that preserves ownership and history:

| User intent | Batch operation | Required identity |
| --- | --- | --- |
| Create agent knowledge | `put_assertion` with `selector: new` | durable assertion key |
| Update agent knowledge | `put_assertion` with `selector: existing` | Assertion ID and current assertion digest |
| Delete agent knowledge | `retract_assertion` | exact agent-owned Assertion ID and digest |
| Dispute a Base fact | `put_challenge` with `effect: flag` | exact Base fact target plus evidence |
| Withdraw a dispute | `retract_challenge` | exact challenge identity |
| Hide a Base fact in curated reads | `put_challenge` with `effect: mask` | exact Base fact target, evidence, and `--allow-masks` |

Never translate “delete this relation” into deletion of a Base node or edge.
Base Graph records and immutable history are not overlay-owned. Ask the user to
choose between a visible Challenge and a stronger curated mask if their intent
is unclear, while continuing any read-only analysis that does not depend on
that choice.

## Verify, audit, and compare

After application, inspect the exact result rather than trusting the generated
request:

```bash
compass agent-graph audit \
  --root . --graph compass-out/graph.json \
  --overlay overlay:auth-review \
  --revision REVISION --format json

compass agent-graph diff OLD_REVISION NEW_REVISION \
  --root . --graph compass-out/graph.json \
  --overlay overlay:auth-review --format json
```

Use `show ASSERTION_ID --revision REVISION` when one assertion needs review.
Export only when the user wants a standalone Effective Graph artifact; choose a
new path because `compass agent-graph export` refuses replacement.

## Rebase after source changes

Refreshing source produces a new Base Generation; Compass never silently moves
old assertions onto it. Keep the pre-refresh overlay revision, run `compass
update .`, then prepare the plan against the new selected graph:

```bash
compass agent-graph rebase-plan \
  --root . \
  --graph compass-out/graph.json \
  --overlay overlay:auth-review \
  --revision OLD_REVISION \
  --format json
```

Exact identities may reattach. Missing, changed, ambiguous, or stale targets
must become explicit grounded replacement or Retraction operations. Do not
select the first candidate. Submit the resulting strict
`compass.agent-graph.rebase-commit/1` request only after every item is resolved:

```bash
compass agent-graph rebase-commit \
  --root . \
  --graph compass-out/graph.json \
  --overlay overlay:auth-review \
  --request rebase-commit.json \
  --enable-writes \
  --format json
```

## Recover from safe failures

- `revision_conflict`: another write advanced the overlay. Read `status`,
  `history`, and `diff`; regenerate against the intended exact revision.
- `idempotency_conflict`: keep the original key for the original content and
  issue a new key for a logically new batch.
- grounding or digest failure: reread the cited source from the selected Base
  Generation and rebuild the evidence. Never weaken or invent the digest.
- unresolved rebase: preserve the old revision, report every unresolved item,
  and do not publish a partial replacement.
- write disabled or unauthorized: retain the proposed batch as a proposal and
  report the exact authority needed. Do not silently retry with broader scope.

## MCP coding-agent sessions

Prefer local stdio for one-user coding sessions. Agent Graph tools are exposed
only when `compass serve` receives a canonical `--agent-graph-project`.
`inspect_agent_graph` remains read-only. `apply_agent_graph` appears only with
`--agent-graph-writes`; masks additionally require `--agent-graph-masks`.
Use `inspect_agent_graph` operation `prepare` with `base_nodes`, `base_edges`,
and `source_spans` before drafting a mutation request.
For HTTP, configure separate read and write credentials and keep the server on
loopback unless remote access is explicitly needed. The server—not model input—
selects the principal, project scope, permissions, expiry, and limits. Load
`references/serve.md` and `references/security-and-boundaries.md` before
starting a network-visible or write-capable service.

At session end, report the exact Base Generation, Overlay ID, final Overlay
Revision, composition profile, applied receipts, and unresolved conflicts. Do
not store prompts, chain-of-thought, credentials, or unrelated user data in the
overlay audit trail.
