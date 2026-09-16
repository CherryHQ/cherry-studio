---
description: Runtime checkpoints, transaction safety and manual verification for independent Pi, Claude and DSH session forks
sources:
  - src/main/ai/agentSession/AgentSessionForkOperations.ts
  - src/main/ai/agentSession/forkFiles.ts
  - src/main/ai/runtime/forkCheckpoint.ts
  - src/main/ai/runtime/forkWorker.ts
  - src/main/data/services/agentSessionFork.ts
  - src/main/data/services/AgentSessionForkService.ts
  - packages/dsh-bridge/src/fork.ts
  - packages/dsh-bridge/src/plugin.ts
---

# Agent Session Fork Verification

## Contract

An Agent assistant message menu exposes **Fork into a new session** at a recorded
complete-turn boundary. This is independent of ordinary chat topic branching.
Only Main resolves SDK identities, paths and boundaries. Message editing cannot
provide a native checkpoint.

The renderer sends `ai.agent.session.fork` with only `sourceSessionId` and
`messageId`. A successful assistant message needs an available native checkpoint.
Missing, failed, corrupt, changed or unsupported checkpoints remain unavailable
with their specific reason. A native fork failure is returned to the caller;
it never creates a child from UI history or silently starts an empty conversation.
Availability and publication share the same Main-only persisted checkpoint schema;
an `available` flag alone cannot enable a malformed checkpoint.

Pi, Claude and DSH own their context management and compaction. Cherry retains
visible messages, source relationships, native checkpoints and resume references,
plus the publication journal needed to recover operation-owned artifacts.
Agent forks do not depend on Chat compression settings.

The new session keeps the Agent and runtime, receives new message IDs, and waits
for input. Its visible history includes the selected prefix; native history and
resume tokens provide the runtime context. Delivery queues, approvals, running
tasks and usage billing are not inherited. Source deletion before publication
rejects the operation; deletion after publication does not cascade to the child.

User workspaces remain shared. System workspaces copy their **current** files,
not historical file versions; forking does not roll files back to the selected
turn. The copy checks file identity, nanosecond timestamps, size and SHA-256
before/after copying, hashes targets, and rescans the source. Links and special
files fail closed. This detects changes during copying; it is not an atomic
snapshot and does not freeze the source afterward. User-owned files named
`.claude` are not excluded.

## Runtime boundaries

| Runtime | Checkpoint | Fork behavior |
| --- | --- | --- |
| Pi | Native session ID and settled prompt leaf ID | Copy native history, open an independent manager, branch only that manager at the recorded leaf; retain its parent snapshot |
| Claude | Final main-thread assistant UUID, fixed prefix byte count and SHA-256, explicit configuration directory/cwd | Private worker SessionStore, unchanged source UUIDs, one SDK forkSession call, inherited checkpoints mapped using forkedFrom |
| DSH | Native session ID, exact turn/end seq and SHA-256 of the canonical event prefix | Verify the prefix from live snapshotEvents or cold SDK persisted log; public seeded session creation in an isolated context without an Agent loop |

DSH seed ownership excludes inherited Inbox items from own events; the durable
end-seed record establishes that boundary. The fork also calls public Inbox.clear.
No automatic-goal or subagent execution services are constructed during creation.

Claude's SDK may emit `result` before its transcript is written. Checkpoint capture
retries missing files or an unflushed target entry at 50 ms intervals, up to 40
retries, and stops when the connection is cancelled. It records the byte prefix
ending at the exact main-thread assistant UUID, excluding later appended entries.
Malformed committed history fails immediately; capture failures log a reason
without transcript content and never turn a successful answer into an error.

Claude refuses publication if required references or opaque compaction metadata
cannot survive SDK processing. In particular, SDK versions that leave preserved
segment UUIDs dangling or move required replacements outside inherited prefixes
return `unsupported_checkpoint`. Native metadata must remain valid for a fork
to be published.

## Manual matrix

Repeat for Pi, Claude and DSH:

1. Complete two turns with distinguishable facts. Fork the first turn; the child
   must know the first fact and not the second. Confirm both the visible prefix
   and the native resume boundary.
2. Fork an inherited boundary in the child to create a grandchild. Resume both
   independently. Delete the source, restart the app and resume the descendants.
3. While the source is generating, awaiting approval, or running a background
   task, fork an earlier completed turn. Confirm the source keeps running and
   child actions do not resolve source approvals or run queued tasks.
4. Open the same source in two windows and click the same boundary concurrently:
   one in-flight result. Clicking again after completion creates another child.
5. Verify completed history without a checkpoint and incomplete turns stay
   disabled with the correct reason. Exercise checkpoint capture failure and
   missing/corrupt, changed or unsupported native histories. If native history
   becomes invalid after the menu was rendered, the request must fail without
   publishing a child or retrying through another context path.
6. For a system workspace, add, delete, replace and rewrite a same-sized file
   while copying. The operation must reject without a visible partial child.
   Check permission failures, a full disk, links, and retry after recovery.
7. Delete the source while reading, copying, preparing native history and before
   commit. Check transaction rollback and owned-artifact cleanup; interrupt cleanup
   and restart to exercise its journal.
8. Pause for backup and shutdown during a fork. No half-published session may be
   backed up; only owned, uncommitted artifacts may be cleaned.
9. Change or unset Chat compression configuration. Native fork/resume behavior
   must remain independent of it.
10. Edit or delete a message sharing its millisecond timestamp with earlier and
    later messages. Only that message and later checkpoints in `(createdAt, id)`
    order become unavailable; earlier checkpoints must remain usable.

Pi: inspect source manager identity, sessionId, sessionFile and leafId during
fork. Normal source appends are allowed, but fork must not switch its manager
or rewind it. Include old-format logs.

Claude: use repeated message text, compaction before/after the selected turn,
preserved segments, replacements and a non-default configuration directory.
Verify the destination project namespace matches the target workspace.
Exercise forks through the registered lazy driver, not only a directly constructed
Claude driver: an available checkpoint must reach the SDK without opening an
Agent connection. Unsupported metadata or SDK failure must prevent publication.
Cancellation must propagate as `cancelled`, never be retried or reported as
missing history.

DSH: remove or stale the projection cache before a cold fork. Confirm the
recorded seq is used exactly, pending Inbox input is absent, goals do not activate,
and tool cwd/session IDs point to the child after the first real resume.
Replace a native log with different events at the same session ID and boundary:
both live and cold forks must reject the native prefix. Normal later appends must
remain valid. Verify inherited checkpoints through child and grandchild forks;
old checkpoints without a prefix hash must stay unavailable.
Verify MCP routing, interactive approvals, and source/child/grandchild forks
after parent deletion. A host-opened fork is an execution root even with
`parentSession` lineage; actual delegated subagents still inherit their execution
root's approval ceiling.
Leave a live fork snapshot unanswered, then cancel the fork or delete its source.
Cancellation must abandon the pending request without waiting for its 60-second
timeout. Cancelling only the fork must keep the source connection usable; a late
snapshot response must not complete a cancelled fork or interfere with a new one.

For shared user workspaces, coordinate file changes between sessions. Forking
preserves the shared directory relationship. Runtime file tools retain their
ordinary permissions and behavior; this feature adds no global file-write locks
or directory cleanup reservations.

## Recovery and cleanup

A child resumes only from its native history and resume reference. Missing or
invalid required native history must explicitly fail after restart as well.
It must never silently resume an empty conversation. Editing/deleting the
selected visible prefix during a fork invalidates publication; appending after
the selected boundary is allowed.

The native publication journal records operation-owned files, their identities,
publication/commit status and workspace retention. Cleanup must confirm ownership
and check registered workspace references, including overlapping directories and
aliases, before removal. Adopted copied directories are retained. Uncertain
ownership, inaccessible paths and legacy records never authorize destructive
cleanup. Test repeated cleanup, recovery after interruption and transaction
rollback with the real SQLite harness.

Windows-only execution and platform simulations are not macOS/Linux native evidence.

## Automated gates

Use existing tests to cover native prefix validation, independent source/child
resume references, chained forks after source deletion, unavailable reasons,
IPC errors, cancellation and ownership-based cleanup. Renderer checks must keep
unavailable checkpoints disabled and issue only the native fork request.

```sh
pnpm --filter @cherrystudio/dsh-bridge build
pnpm --filter @cherrystudio/dsh-bridge test
pnpm test:main src/main/ai/runtime/dsh/__tests__/DshBridgeServer.test.ts src/main/ai/runtime/dsh/__tests__/DshRuntimeConnection.trace.test.ts
pnpm test:main src/main/data/services/__tests__/AgentSessionMessageService.test.ts src/main/ai/agentSession/persistence/__tests__/AgentSessionMessageBackend.test.ts
pnpm exec vitest run --project main src/main/ai/runtime/__tests__/registerDrivers.test.ts src/main/ai/runtime/claudeCode/__tests__/ClaudeCodeRuntimeDriver.test.ts
pnpm test:main src/main/ipc/handlers/__tests__/ai.test.ts
pnpm test:shared src/shared/ipc/schemas/__tests__/ai.test.ts
pnpm test:renderer src/renderer/components/chat/messages/frame/__tests__/messageMenuBarActions.test.tsx src/renderer/pages/agents/messages/__tests__/agentMessageListAdapter.test.tsx
pnpm lint
pnpm db:migrations:check
pnpm docs:check
```

Use the real SQLite harness (production migrations), and real SDK fixtures without
model calls for native boundaries and chained forks. Keep extensions to existing
tests. Remove operation-owned temporary tests/data after verification; never
remove pre-existing project tests or unrelated user files. Record actual Electron
and model-resume results separately; passing fixture tests is not live-model proof.
