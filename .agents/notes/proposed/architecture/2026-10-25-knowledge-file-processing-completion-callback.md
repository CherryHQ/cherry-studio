# Agent Note: Check a file's processing result when the job settles instead of polling it

Status: proposed

English | [中文](2026-10-25-knowledge-file-processing-completion-callback.zh.md)

## Problem

A file that needs conversion waits for its FileProcessing job through `knowledge.check-file-processing-result`, a job that enqueues its next round every 5 seconds until the FileProcessing job settles. Each round is a new job row, and the chain also serves three other purposes:

- Progress: each round copies the FileProcessing job's progress onto `knowledge.item.file_processing_progress.${itemId}`. The row's percentage lags by up to 5 seconds and is broadcast again even when unchanged.
- Cancellation: delete, replace, and base deletion find the FileProcessing job to cancel through the active check row (`getLinkedFileProcessingJobIds`).
- Reindex failure handling: a failed `reindex-subtree` treats the check row as an active follow-up job and does not fail its root.

Since #22089 removed the 20-file cap, a batch can queue far longer behind local processors that run one file at a time. [#22636](https://github.com/CherryHQ/cherry-studio/pull/22636) stops counting queue time toward the 30-minute limit. Job rows still grow with the time spent queued: 150 files queued for an hour leave about 108,000 rows until the 7-day GC removes them. The poll chain was originally needed because the check job was resumed after a restart (`recovery: 'retry'`, #15470). #16296 changed it to `abandon`, so the chain no longer survives a restart either.

## Proposal

- `FileProcessingService.startJob` returns the `JobHandle` instead of its snapshot. The IPC route still returns the snapshot.
- `scheduleItem` registers the item in a `FileProcessingWaitManager`, which `KnowledgeService` owns, and waits on `handle.finished`. When the job settles, it removes the entry and enqueues one `check-file-processing-result`, with no delay and no `pollRound`. That job validates the result and schedules indexing as before.
- One `registerInterval` on `KnowledgeService` copies each waited job's progress onto the item key every 5 seconds and writes only values that changed. Removing the entry clears the key, so the key no longer needs a TTL.
- `cancelActiveKnowledgeJobs` also cancels the FileProcessing jobs that the removed items wait on. It reads the registry only after the knowledge-job cancels settle. A failed `reindex-subtree` does not fail a root that is still waiting.
- The Knowledge-side 30-minute limit is removed. The FileProcessing handlers' own timeouts (15 minutes for background jobs, 30 for remote polling) bound a running job.

Out of scope: telling queued files from running ones in the UI, and keeping a conversion's work across a restart instead of cancelling it.

## Alternatives considered

- Let the renderer subscribe to `jobs.progress.${jobId}`. Rejected: a Knowledge item must not reach past the Knowledge service to a JobManager job, and it would add one subscription per item.
- Keep a durable placeholder check row, and add a JobManager API that runs a delayed job immediately. Delete and reindex could keep following the row, but this adds a core API for a wait that ends at a restart anyway, just like `finished`.
- Find the jobs to cancel by listing active FileProcessing jobs and matching `context.dataId`. This survives a restart, but it adds a query to every delete, and the progress timer still needs an in-memory map.

## Acceptance criteria

- AC1 — A file that needs conversion gets exactly one `check-file-processing-result` job, enqueued after its FileProcessing job settles, and none while it waits. (verification: unit)
- AC2 — While an item waits, its row shows the FileProcessing job's latest progress, broadcast only when the value changes, and the percentage disappears when the job settles. (verification: unit)
- AC3 — Deleting an item, replacing it, or deleting its base cancels the FileProcessing job it waits on, including a job started by a copy job that was cancelled after its commit. (verification: unit)
- AC4 — A failed `reindex-subtree` does not mark a root failed while that root waits on file processing. (verification: unit)

## Risks

- The wait lives in memory. A restart leaves the item to boot recovery, which fails it. The layer below starts the FileProcessing job with `recovery: 'abandon'`, so startup recovery cancels it instead of resuming it with nothing waiting. Its migration gives the conversions Knowledge started before the upgrade the same override.
- If the check job cannot be enqueued after the FileProcessing job settles, the error is logged and the item stays `processing` until the next boot recovery fails it.
