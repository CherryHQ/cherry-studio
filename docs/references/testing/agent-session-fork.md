---
description: Native fork contracts and verification for Pi, Claude and DSH
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

Completed Agent assistant messages offer **Fork**; incomplete messages stay
disabled. The renderer sends `ai.agent.session.fork` with `sourceSessionId` and
`messageId`. Main resolves native history and validates the selected boundary.
Known fork failures show localized reasons without an "Unknown error" prefix.
Failed requests publish no session; UI text never substitutes for native context.

Native identifiers live in Main-private `data.runtimeAnchor`; message edits cannot
supply them. There is no persisted availability flag, application-level ancestry
or fork-specific SQL migration. Each runtime manages its own context and
compaction independently of Chat compression settings and ordinary topic branching.

The new session keeps the Agent, runtime and selected message prefix, assigns new
message IDs, and waits for input. It resumes from independent native history and
inherits no delivery queues, approvals, running tasks or usage charges. Source
deletion before publication rejects the fork; deletion afterward leaves it intact.

User workspaces remain shared. System workspaces copy **current** files without
rolling back to the selected turn. Copying compares file identity, nanosecond
timestamps, size and SHA-256, verifies targets, and rescans the source. Changes,
links and special files reject the copy; user-owned `.claude` files are included.
This is not an atomic snapshot and does not freeze later source changes.

## Runtime boundaries

| Runtime | Native identifier | Fork behavior |
| --- | --- | --- |
| Pi | Session ID and settled prompt leaf ID | Copy history and branch an independent manager at the leaf, retaining its parent snapshot |
| Claude | Session ID, final main-thread assistant UUID and configuration directory | Private worker `SessionStore`, one SDK `forkSession` call, inherited identifiers mapped through `forkedFrom` |
| DSH | Session ID and exact `turn/end` seq | Validate a live `snapshotEvents` prefix or persisted log, then seed an independent session |

Claude rechecks the selected byte prefix while reading. An unflushed assistant
entry returns `history_missing` and can be retried. Dangling compaction references
or required replacements outside inherited prefixes return `unsupported_checkpoint`.

DSH validates event structure at fork time, without a turn-completion checkpoint
RPC. The durable end-seed record excludes inherited Inbox items; `Inbox.clear`
removes child-owned input. Creation starts no Agent loop, goals or subagents.
Fork-time validation checks current history, not equality with a saved digest.

## Manual matrix

Repeat for Pi, Claude and DSH:

1. Complete two turns with distinct facts; fork the first. Visible and native
   history must include only the first fact.
2. Fork an inherited boundary again. Delete the source, restart, and resume both
   new sessions independently.
3. Fork an earlier turn while the source generates, awaits approval or runs a
   task. Source execution continues; its approvals and queues remain separate.
4. Click the same boundary concurrently in two windows: one in-flight result.
   A later click creates another session.
5. Click a completed message with missing identifiers or invalid native history:
   show the specific error without a generic prefix or a new session. Incomplete
   messages remain disabled. Retry Claude after its transcript has flushed.
6. During a system-workspace copy, add, delete, replace or rewrite a same-sized
   file. Reject partial copies. Also check permissions, full disk, links and retry.
7. Delete the source during reading, copying, native preparation and before commit.
   Verify rollback, owned-file cleanup, and recovery after interrupted cleanup.
8. Start backup or shutdown during a fork. No partial session enters a backup;
   cleanup removes only owned, uncommitted artifacts.
9. Change or unset Chat compression settings; fork and resume remain unaffected.
10. Edit/delete a message whose timestamp matches its neighbors. Discard native
    identifiers from that message onward in `(createdAt, id)` order; keep earlier ones.

Pi: include old-format logs. Verify source manager identity, `sessionId`,
`sessionFile` and `leafId` stay unchanged by the fork; later appends are allowed.

Claude: cover repeated text, compaction before/after the boundary, preserved
segments, replacements and a non-default configuration directory. Check the target
project namespace and dispatch through the registered lazy driver without opening
an Agent connection. Unsupported metadata prevents publication; cancellation
returns `cancelled` without retry.

DSH: test live and cold forks with a missing/stale projection cache. Require the
exact seq, reject invalid prefixes, and allow later appends. Verify remapped
identifiers through repeated forks, empty Inbox, inactive goals, and child cwd,
MCP routing and approvals after resume and source deletion. Seeded forks have no
`parentSession`; delegated subagents still inherit their execution root's approval ceiling.

Leave a live DSH snapshot unanswered, then cancel or delete its source. Cancellation
must not wait for the 60-second timeout. Cancelling only the fork leaves the source
usable; late responses cannot complete cancelled forks or affect later requests.

Shared user workspaces retain ordinary file permissions and behavior. Coordinate
file changes between sessions; forks add no global write locks or cleanup reservations.

## Recovery and cleanup

The `app_state` publication journal records artifact ownership, commit status and
workspace retention. Committed entries also identify sessions that require native
history: missing/invalid history or resume references must fail explicitly,
including after restart. Editing/deleting the selected prefix prevents publication;
later appends are allowed.

Cleanup verifies ownership and registered workspace references, including aliases
and overlaps. Retain adopted directories and files with uncertain ownership or
inaccessible paths; legacy journals grant no authority to delete adopted workspaces.
Test rollback, repeated cleanup and restart recovery with the real SQLite harness.

## Automated gates

Existing tests cover native boundaries, repeated forks, source deletion, IPC
errors, cancellation and cleanup. Renderer tests cover menu availability and
localized failures without the generic error prefix.

```sh
pnpm --filter @cherrystudio/dsh-bridge build
pnpm --filter @cherrystudio/dsh-bridge test
pnpm test:main src/main/ai/runtime/dsh/__tests__/DshBridgeServer.test.ts src/main/ai/runtime/dsh/__tests__/DshRuntimeConnection.trace.test.ts
pnpm test:main src/main/data/services/__tests__/AgentSessionMessageService.test.ts src/main/ai/agentSession/persistence/__tests__/AgentSessionMessageBackend.test.ts
pnpm exec vitest run --project main src/main/ai/runtime/__tests__/registerDrivers.test.ts src/main/ai/runtime/claudeCode/__tests__/ClaudeCodeRuntimeDriver.test.ts
pnpm test:main src/main/ipc/handlers/__tests__/ai.test.ts
pnpm test:shared src/shared/ipc/schemas/__tests__/ai.test.ts
pnpm test:renderer src/renderer/components/chat/messages/frame/__tests__/messageMenuBarActions.test.tsx src/renderer/pages/agents/messages/__tests__/agentMessageListAdapter.test.tsx src/renderer/utils/__tests__/error.test.ts
pnpm lint
pnpm db:migrations:check
pnpm docs:check
```

Use production migrations and real SDK fixtures; extend existing tests and clean
up only task-owned temporary files. Record Electron, live-model and native
Windows/macOS/Linux results separately from fixtures and platform simulations.
