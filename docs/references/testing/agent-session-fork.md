---
description: Runtime checkpoints, transaction safety and manual verification for independent Pi, Claude and DSH session forks
sources:
  - src/main/ai/agentSession/AgentSessionForkOperations.ts
  - src/main/ai/agentSession/forkFiles.ts
  - src/main/ai/runtime/forkCheckpoint.ts
  - src/main/ai/runtime/forkWorker.ts
  - src/main/data/services/AgentSessionForkService.ts
  - packages/dsh-bridge/src/fork.ts
---

# Agent Session Fork Verification

## Contract

An Agent assistant message menu exposes **Fork as new session** at a recorded
complete-turn boundary. This is independent of ordinary chat topic branching.
Only Main resolves SDK identities, paths and boundaries. Message editing cannot
provide a native checkpoint. Completed old messages can rebuild a new session
from saved history when no valid native checkpoint exists.

The new session keeps the Agent and runtime, receives new message IDs, and waits
for input. Delivery queues, approvals, running tasks and usage billing are not
inherited. Source deletion before publication rejects the operation; deletion
after publication does not cascade to the child.

User workspaces remain shared. System workspaces copy their **current** files,
not historical file versions. The copy checks file identity, nanosecond
timestamps, size and SHA-256 before/after copying, hashes targets, and rescans
the source. Links and special files fail closed. This detects changes during
copying; it is not an atomic snapshot and does not freeze the source afterward.
User-owned files named `.claude` are not excluded.

## Runtime boundaries

| Runtime | Checkpoint | Fork behavior |
| --- | --- | --- |
| Pi | Native session ID and settled prompt leaf ID | Copy complete native log, open an independent manager, branch only that manager; retain its parent snapshot |
| Claude | Final main-thread assistant UUID, fixed prefix byte count and SHA-256, explicit configuration directory/cwd | Private worker SessionStore, unchanged source UUIDs, one SDK forkSession call, inherited checkpoints mapped using forkedFrom |
| DSH | Native session ID and exact turn/end seq | Live snapshotEvents or cold SDK persisted log; public seeded session creation in an isolated context without an Agent loop |

DSH seed ownership excludes inherited Inbox items from own events; the durable
end-seed record establishes that boundary. The fork also calls public Inbox.clear.
No automatic-goal or subagent execution services are constructed during creation.

Claude refuses publication if required references or opaque compaction metadata
cannot survive SDK processing. In particular, SDK versions that leave preserved
segment UUIDs dangling or move required replacements outside inherited prefixes
return `unsupported_checkpoint`. The fork then rebuilds from saved messages,
as disclosed in the confirmation dialog; it does not claim native restoration.

## History reconstruction

Main first attempts a native fork without permission to rebuild history. Valid
checkpoints fork directly without a dialog. Legacy, failed, missing, corrupt or
unsupported checkpoints request a short confirmation before reconstruction;
incomplete turns and workspace errors do not offer reconstruction. Cancelling
creates no session. Requests with different reconstruction consent never share
an in-flight result.
The child keeps its own full UI prefix and no inherited resume token. UI messages
are **not** the model context. Migration 0022 adds an owned context document;
legacy children lazily create it from their own saved prefix. `buildForkHistory`
now reads a prepared context only, never raw UI rows. Imported old turns do not
acquire native checkpoints.

Each snapshot contains ordered immutable positions, message IDs, turn IDs, text,
content hashes and multimodal-reference flags. Coverage is half-open `[0, end)`;
UI edits/reordering cannot move these positions. Summary text is stored in a
`kind: summary` segment. Segments also carry source role, ranges, message IDs,
snapshot ID and a hash. `segments`, `retainedSegments` and `layout` specify the
complete ordered representation. Tool inputs, call IDs, approval state and
internal reasoning are omitted; saved tool results are untrusted historical text.
Nothing is injected as system/developer instructions or executable tool calls.

Selection walks the recorded ancestor chain, never the latest arbitrary summary.
Every ancestor must pass snapshot, prefix-hash, message-ID, segment, coverage and
parent validation. Runtime, schema, SDK, compressor/model, system-prompt and
toolset fingerprints must match. A missing, collected or hash-corrupt ancestor
invalidates reuse. Child copies remap IDs into independently owned snapshots and
summaries, so deleting ancestors does not remove descendant context.

Pi captures the settled manager's compacted model context at the exact leaf. DSH
uses SDK folding of the exact immutable event prefix in an isolated worker, not
the projection cache. Claude's opaque-format whitelist is currently empty:
native checkpoint restoration still takes priority, but fallback histories use
fresh compression rather than interpreting opaque Claude summaries.

With a valid summary, preparation adds only the remaining selected history and
does not call a compression model when the result fits. Otherwise previously
compacted or over-budget histories are compressed using bounded input chunks.
At most two further compression rounds reduce summary/tail size; retained tail
boundaries are whole turns. Remaining excess, unknown context limits or missing
compression configuration stop the send; there is no silent full-history fallback.
History attachments inherit names/media types only, not bytes; reattach content
when needed. New input uses the existing text tokenizer and media estimates.
Opaque SDK prompts reserve additional capacity; this is a conservative estimate,
not proof of the provider's exact total token count.

Preparation is single-flight per session/configuration and persists a stable
`preparedContextId`. States are `forkCreated -> contextPreparing -> contextReady
-> sending -> sent/failed/cancelled`. A send intent records selected summary,
snapshot boundary, segment/history hashes and new user/assistant IDs before SDK
submission. Only the matching persisted successful assistant receipt confirms
it. A crash between persistence and confirmation can reconcile that receipt;
otherwise an uncertain send requires inspection and is not blindly reinjected.
Network failures are retryable; configuration/boundary/budget failures require
correction. Cancellation before submission can retry preparation. A ready result
is reused after restart. Preparation state and audits remain in Main; the
conversation right pane does not display fork context details.

GC runs when saving a context: head/prepared/audit roots retain their ancestor
closures, and unreachable summaries are removed. Audit-referenced records live
until their owning session is deleted; database cascade then deletes that owned
document. Configuration changes force revalidation/repreparation rather than
deleting other sessions' copies. No wall-clock TTL evicts referenced records.

Boundary validation proves the compression input excludes future messages. It
does not guarantee semantic accuracy: a summarizer can omit or invent details.
The full UI history remains available independently of generated compression.

## Manual matrix

Repeat for Pi, Claude and DSH:

1. Complete two turns with distinguishable facts. Fork the first turn; the child
   must know the first fact and not the second.
2. Fork an inherited boundary in the child to create a grandchild. Resume both
   independently. Delete the source, restart the app and resume the descendants.
3. While the source is generating, awaiting approval, or running a background
   task, fork an earlier completed turn. Confirm the source keeps running and
   child actions do not resolve source approvals or run queued tasks.
4. Open the same source in two windows and click the same boundary concurrently:
   one in-flight result. Clicking again after completion creates another child.
5. Verify old completed history can fork, the confirmation explains reconstruction,
   and incomplete turns remain disabled. Test checkpoint failure and missing/corrupt
   or unsupported native histories. Confirm the first child prompt receives the
   selected prefix exactly once and no later messages, queued input or approvals.
6. For a system workspace, add, delete, replace and rewrite a same-sized file
   while copying. The operation must reject without a visible partial child.
   Check permission failures, a full disk, links, and retry after recovery.
7. Delete the source while reading, copying, preparing native history and before
   commit. Check rollback; interrupt cleanup and restart to exercise its journal.
8. Pause for backup and shutdown during a fork. No half-published session may be
   backed up; only owned, uncommitted artifacts may be cleaned.

Pi: inspect source manager identity, sessionId, sessionFile and leafId during
fork. Normal source appends are allowed, but fork must not switch its manager
or rewind it. Include old-format logs.

Claude: use repeated message text, compaction before/after the selected turn,
preserved segments, replacements and a non-default configuration directory.
Verify the destination project namespace matches the target workspace.

DSH: remove or stale the projection cache before a cold fork. Confirm the
recorded seq is used exactly, pending Inbox input is absent, goals do not activate,
and tool cwd/session IDs point to the child after the first real resume.

## Automated gates

Context-specific cases: assert actual runtime/compressor messages exclude future
canaries and executable tool input; valid Pi/DSH summaries make zero compressor
calls; source/child deletion leaves grandchildren usable; corrupt/missing
ancestors force regeneration; concurrent callers share preparation; cancelled
preparation retries; host restart reuses prepared IDs; uncertain sends remain
blocked until the exact persisted assistant receipt is verified.

```sh
pnpm --filter @cherrystudio/dsh-bridge build
pnpm test:main src/main/data/services/__tests__/AgentSessionMessageService.test.ts src/main/ai/agentSession/persistence/__tests__/AgentSessionMessageBackend.test.ts
pnpm test:renderer src/renderer/components/chat/messages/frame/__tests__/messageMenuBarActions.test.tsx
pnpm lint
pnpm db:migrations:check
pnpm docs:check
```

Use the real SQLite harness (production migrations), and real SDK fixtures without
model calls for native boundaries and chained forks. Keep extensions to existing
tests. Remove operation-owned temporary tests/data after verification; never
remove pre-existing project tests or unrelated user files. Record actual Electron
and model-resume results separately; passing fixture tests is not live-model proof.
