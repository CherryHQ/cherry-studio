# Agent Note: Pi Durable desktop forks share one backend owner

Status: implemented

English | [中文](2026-11-09-pi-durable-desktop-fork.zh.md)

## Problem

Pi Durable supported native same-storage forks, but desktop replies had no fork checkpoint and each connection owned its own Harness. Adding only a driver method would create competing owners and route siblings through one root's model, approval and environment closures.

This decision replaces the isolated-target-backend prerequisite and Durable desktop edit exclusion in [the history-operation proposal](../../proposed/architecture/2026-11-08-agent-history-operation-boundaries.md). It preserves native history, independent product sessions, failure recovery and current workspace files. It adds no upstream SDK patch, dependency upgrade or product database migration.

## Decision

### Scope

Successful Pi Durable replies with new committed checkpoints support the existing desktop **Fork** action. A fork lineage shares a backend; unrelated sessions retain separate stores. Edit and resend replaces the selected product-tree tail without retaining a new history version. Desktop requires confirmation before submitting the edit; cancelling preserves its draft and original messages. Hiding or unmounting its originating view invalidates the pending confirmation, including when the same session is shown again. First-input edits start a fresh context; later edits require a valid predecessor checkpoint. Legacy replies cannot establish a native boundary; file rewind and `vcc_recall` remain unsupported.

The SDK's public `tx.forkConversation()` creates an ownerless conversation at the selected visible entry. Native history, compaction and document fork policies remain SDK-owned. Subsequent connection setup applies the destination's current product configuration.

### Backend and host ownership

`PiDurableRuntimeDriver` serializes backend initialization, native fork preparation and final release on one backend-scoped queue. One `DurableBackend` owns the Harness, model registry, root host resources and execution environments. Connections borrow root handles and own observations and child projections. Final release closes the native owner once, drains callbacks and flushes product writers before a replacement owner can open. A failed product flush can retry without closing the native owner again.

Native task ownership maps conversations to product roots; history ancestry does not make a fork belong to its source. Models, request parameters, trace, billing, approvals, questions, attendance, MCP, skills, prompt sections and environments resolve to that root. Provider registrations and selected extension names are unique per binding. Durable uses stable catalog model keys across restart; Pi keeps its existing native model-key contract. Shared `Models.find` and verifier requests now carry the actual thread.

Host resources remain alive while the backend can run retained work. Root request selections are stored in the native `cherry.desktop-request` document: model, reasoning, service tier, Fast and knowledge selection, without credentials or trace spans. On cold recovery, the driver identifies roots with unfinished native tasks and attaches their existing Main connection and projection consumer before resuming the shared scheduler. A temporary readiness barrier transfers across host replacement; it is not a second task ledger. Missing product ownership fails recovery rather than running an unbound root. Explicit Stop remains conversation-scoped.

### Checkpoints and publication

The atomic completion batch carries its last visible committed entry ID with the content and terminal input facts. The opaque checkpoint contains backend, conversation and entry IDs. Previews and idle activity cannot establish a fork boundary. An active preview present at observer attachment remains live; treating it as historical would hide the entire recovered generation from the product writer. The committed prefix remains historical. A preview that disappears and later returns receives a new local identity even if the native task and attempt number repeat; a retired product source cannot be reused. The driver checks the source product binding, validates every retained checkpoint against the chosen native prefix, and forks on the current owner's mutation line. A cold fork uses a native Session on the same serialized backend queue without starting a Harness or scheduler.

The coordinator allocates a target context identity and records it in the operation journal before native preparation. The native fork and its product-context marker commit together. Repeating the same preparation reconciles that marker and its source boundary instead of duplicating the conversation. The result carries the allocated context ID into the existing atomic product session/message/binding publication. Remapped checkpoints name the new conversation and retain native ancestor entry IDs.

Native and product commits are separate. Cancellation or a failed product commit publishes no partial product session. A prepared native orphan stays ownerless, inert and identifiable in the retained journal; the SDK has no public conversation deletion API. Cleanup removes only proven operation-owned unpublished files. It never truncates or deletes shared storage. Source deletion retains the ancestry needed by surviving forks.

Inherited model context remains visible, while behavior authority comes only from conversation-owned records. Ancestor goals, child controls, summary charges and job keys cannot become the fork's authority. Native tasks, submissions and provider state are not copied by the ownerless fork. Product copies also strip live task/approval state and usage statistics.

System workspaces copy current files; user workspaces remain shared. Neither action restores historical file versions. Edit and resend removes the original input and its descendant subtree and publishes a replacement tail atomically; existing sibling branches outside that subtree and independent forks remain intact. Removed root-projection sources are tombstoned against replay. An outstanding outgoing delivery prevents editing so its return anchor cannot disappear. Native history remains adapter-owned rather than being truncated. Noninitial edits reuse native fork preparation, retain its allocated product context identity, and publish the replacement input, context binding and branch-specific checkpoint mapping in one product transaction. First-input edits reserve a fresh empty backend/context without forking or starting native work during preparation. The old native input binding is never reused. Publication and recovery check the exact context because native numeric IDs may repeat across stores. Unpublished preparations remain inert under the same retained-journal policy.

### Implementation owners

| Owner | Responsibility |
|---|---|
| Durable package projection and runtime | Atomic checkpoint evidence, native transaction access and conversation-owned behavior facts |
| Durable driver, backend and connection | One owner, root host selection, readiness, retained request configuration and access release |
| Existing Pi gateway and behavior helpers | Unique native bindings and thread-correct host requests without another parameter translator |
| Fork coordinator, resource journal and data service | Prepared identity, native reconciliation and atomic product publication |
| Shared history eligibility | Evidence-backed Fork and Edit and resend |

## Alternatives considered

- A separate target database requires cross-storage SDK export/import and is unnecessary for conversation independence.
- Another Harness over the same store creates competing owners and does not fix captured root closures.
- Keeping the source connection as the lineage owner couples surviving forks to source deletion.
- Replaying product text loses native history, compaction and document semantics.
- Copying or truncating live SQLite bypasses native task and history ownership.

## Verification

- AC1 — Main history-action tests allow first-input edits and reject unsupported predecessor and legacy/malformed boundaries. Durable completion tests pair the committed entry with final content and input outcomes, including blocked observers and attachment to an existing partial generation. The live UI exposes Fork at the new boundary.
- AC2 — Real SQLite tests and the public-API native probe preserve the exact prefix and historical `AgentDoc`; source appends are excluded, cold fork preparation is idempotent, prefixes spanning stores with equal native IDs retain separate context ownership, and ownerless history facts retain context without ancestor behavior authority. Existing compaction and archive suites remain green.
- AC3 — Main lifecycle tests share one runtime across roots, isolate release, serialize final close/reopen, and retry failed archive flush. The live parent/fork run confirms the same Harness identity.
- AC4 — Concurrent Main tests write through separate system workspaces and approval channels. Production gateway tests preserve each root's session headers and reasoning settings with a shared model registry. A cold pending-peer test restores its `high + Fast` request and consumer while the fork uses `low`; existing child, MCP, summary and behavior consumers pass. In real-provider Electron acceptance, closing the source tab during partial output and restarting with only its fork open resumes the source, writes the complete result into the original assistant message and keeps the fork independent.
- AC5 — File-backed product publication tests cover cancellation, failed commit and journal recovery. Native receipt-loss and repeated cold preparation reconcile one conversation; no partial product fork appears and retained native preparations do not execute.
- AC6 — Main tests delete the source and reopen the fork, then fork an older inherited checkpoint. Electron permanently deletes the source through the production lifecycle, restarts the app, continues the surviving fork and forks its older checkpoint again.
- AC7 — Electron uses real LongCat AI `longcat::LongCat-2.5`: the source answers `kiwi` after its later update while the selected-prefix fork answers `apricot`. Usage records bind to distinct assistant messages; copied current files survive. Restarted forks also answer `apricot`. Local evidence lives under `.context/cherry-electron-dev/durable-desktop-fork/`.
- AC8 — Focused Pi and shared behavior contracts, Claude/Pi multi-context fork consumers, Node/package types, scoped lint and documentation checks cover the affected boundaries. No new SDK patch is present. Module and fork/runtime references describe the delivered scope.
- AC9 — Real SQLite tests cover first, later and repeated tail replacement, reopen, existing sibling preservation, outgoing-delivery admission, fork after editing, close/product-commit failures and lost native receipts. Equal native IDs across stores cannot misbind publication or establish a false publication receipt. Real LongCat UI acceptance for Pi, Pi Durable and Claude Code yields inherited apricot and fresh-first-input mango; deleted messages return 404, no new version switcher appears, a fork created before replacement still answers plum, and current files remain unchanged. Evidence is under `.context/cherry-electron-dev/edit-in-place/`.

The offline cases use native SQLite and scripted providers; they are separate from the real-provider Electron runs. Graceful close/reopen and injected receipt loss do not prove process-kill recovery or exactly-once external tool effects.

## Consequences

- Storage/scheduler failure affects the whole backend lineage; accesses receive that shared failure.
- Native ancestry and confirmed unpublished forks consume storage. This feature introduces no native pruning policy.
- Recovery requires a usable product binding and model/host configuration for retained work; it does not guess ownership from copied text.
- Workspace copying preserves current files and may reject concurrent file changes; Fork is not file rewind.
