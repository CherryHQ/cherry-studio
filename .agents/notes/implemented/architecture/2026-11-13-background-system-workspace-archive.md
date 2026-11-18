# Agent Note: Archive Agent Session system workspaces in the background

Status: implemented

English | [中文](2026-11-13-background-system-workspace-archive.zh.md)

## Problem

Archiving Agent Sessions waits for system-workspace compression to finish before the request resolves. The call chain is `deleteSessionsInternal → finishDeletion → await archiveSystemWorkspaces`, and `archiveSystemWorkspaces` awaits `agentWorkspaceStorageService.archiveWorkspace` once per workspace, sequentially (`src/main/ai/agents/AgentLifecycleService.ts:391-411`, `:506-514`, `:547-575`).

The business state is already committed before this wait starts. Even so, the list update and the undo entry wait for every `tar.gz` pack. Large workspaces, many files, and batch archives make that wait long. Issue #21645 tracks this.

## Proposal

Split the archive into a foreground commit and a background conversion.

- **Foreground.** The existing sessions-in-progress check stays. Runtime close stays foreground and keeps its current order: cancel forks, close the runtime, then recover forks. After the business archive commits, the request returns. The list and undo entry update without waiting for compression.
- **Durable task in the same transaction.** Business archive state and one `archive-system-workspace` JobManager task per archived system workspace commit in one SQLite transaction, through `JobManager.enqueueTx`. A rollback drops both. A task that survives a crash after commit runs after restart.
- **Background handler.** The handler takes the existing per-workspace storage mutex, re-reads the workspace business state, and calls `AgentWorkspaceStorageService.archiveWorkspace` only if the workspace is still archived. Compression, recovery records, and path handling stay in `AgentWorkspaceStorageService`. The handler does not duplicate them.
- **Undo.** Restoring a workspace cancels its queued archive task. If an archive is already running, restore waits on the same storage mutex. The workspace becomes runnable only after the storage operation ends, so a stale task cannot archive a restored workspace.
- **Failure.** Runtime-close or compression failure keeps the workspace directory, logs the error, and lets the task retry. A workspace whose archive is pending or failing does not admit a writer into the directory being converted.
- **Concurrency and shutdown.** Batch archives are limited by a JobManager concurrency cap. The application shutdown and backup coordination drain or wait for in-flight archive tasks.
- **Scope.** Only system workspaces are compressed. User workspaces keep their directories. Native JSONL paths and each harness's resume identity stay unchanged. Native log cleanup after permanent deletion stays with the existing orphan sweep.

## Alternatives considered

- **Keep the await.** Rejected. Response time still grows with workspace size, and the undo entry is delayed.
- **`void archiveWorkspace()` without a task.** Rejected. A crash after commit loses the compression, and restart, undo, cleanup, and shutdown cannot be coordinated.
- **A separate archive queue outside JobManager.** Rejected. It adds a second persistence and retry mechanism. JobManager already provides `enqueueTx`, retry, and restart recovery.
- **Move the native JSONL with a rename, as Codex does.** Rejected. Cherry Studio's native logs are owned by each harness and keep their resume paths. The compression here packs a system workspace, a different operation with different ownership.
- **Defer runtime close into the background task too.** Rejected for this Spec. Closing the runtime releases file writers before packing. Moving it into the task would make the foreground commit depend on a writer that may still be open, so close stays foreground.

## Acceptance criteria

- AC1 — With compression of a system workspace held open, the archive request resolves and the list and undo entry reflect the committed archive before compression finishes. (verification: unit)
- AC2 — The business archive state and the archive-task enqueue commit or roll back together, and a task persisted after commit completes after a restart. (verification: unit)
- AC3 — Undo of an archive whose compression is queued, in progress, or complete leaves the workspace runnable, and a stale queued archive task does not archive it again. (verification: unit)
- AC4 — A runtime-close failure or a compression failure keeps the workspace directory, logs the error, and allows retry; no writer keeps writing into a directory being converted. (verification: unit)
- AC5 — Restart recovery, repeated task execution, permanent deletion after archive, and orphan sweep running alongside archive tasks neither lose a recovery source nor activate a session by mistake. (verification: unit)
- AC6 — Batch archive respects the concurrency cap, and user directories and native JSONL paths remain unchanged after archive and recovery. (verification: unit)

## Risks

- `enqueueTx` runs post-commit side effects. A failure there must not roll back the business archive, so the task-enqueue failure path needs its own test.
- The undo race spans the task queue and the storage mutex. A missed cancellation would archive a restored workspace, so AC3 must cover all three compression states.
- Shutdown drain adds latency to quit when a large archive is running.
- The write path for a workspace that is still being archived is new behavior. Its failure mode is an extra error, not data loss, but the UI must not show a session as usable while its directory is converting.

## Verification

- AC1 — `AgentLifecycleService.workspace.test.ts` "archives only system files and restores them before making the session active": `archiveSessions` resolves with the directory intact and the business `deletedAt` committed while exactly one `agent.archive-system-workspace` task is enqueued for the system workspace; the directory is packed only after the queued task runs. "blocks overlapping registration throughout archive shutdown and releases the reservation afterward" shows the request resolving before the task's quiesce holds the storage reservation.
- AC2 — `AgentLifecycleService.workspace.test.ts` "commits the business archive and the archive task atomically": trashing inside a transaction that then rolls back leaves the session active, the enqueue went through the caller's transaction, and no job row persists. The handler declares `recovery: 'retry'`, so a task persisted at commit is replayed by JobManager startup recovery (covered by the JobManager suites).
- AC3 — `AgentLifecycleService.workspace.test.ts` "cancels a queued archive task when the archive is undone" (queued: `JobManager.cancel` runs before activation and a stale replay skips the restored workspace) and "waits for an in-flight archive task when the archive is undone" (running: restore waits for the task instead of aborting the pack); completed compression is covered by the pre-existing restore tests, which now run the queued task first. `agentArchiveWorkspaceJobHandler.test.ts` "skips a workspace restored after the task was queued" covers the handler's business-state re-read.
- AC4 — `AgentLifecycleService.workspace.test.ts` "keeps the directory if runtime shutdown fails" (directory retained, failure logged, task still queued for retry) and "releases the storage reservation when strict runtime shutdown fails" plus "sweep preserves pending restore intent..." (the pack failure surfaces through the task and retains the pending record for the sweep's retry); `agentArchiveWorkspaceJobHandler.test.ts` "propagates a compression failure so the task retries" with `defaultRetryPolicy.maxAttempts` > 1.
- AC5 — `agentArchiveWorkspaceJobHandler.test.ts` "skips when the workspace row is gone, e.g. permanently deleted" (repeated or post-purge execution) and the recovery declaration test; the pre-existing orphan-sweep cases in `AgentLifecycleService.workspace.test.ts` (purge/retention, claimed archives, restore-intent preservation) run against the new task flow unchanged.
- AC6 — `agentArchiveWorkspaceJobHandler.test.ts` "declares restart recovery, a shared queue and a batch concurrency cap" (`defaultConcurrency: 2`, one shared queue); "archives only system files..." asserts the user workspace directory is never packed, and only system workspaces are enqueued (root sessions joined against `AGENT_WORKSPACE_TYPE.SYSTEM`), so user directories and native JSONL paths are untouched.
