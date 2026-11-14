# Agent Note: Archive Agent Session system workspaces in the background

Status: proposed

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
