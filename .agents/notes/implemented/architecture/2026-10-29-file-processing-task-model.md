# Agent Note: Give FileProcessing its own task model instead of exposing JobManager jobs

Status: implemented

English | [中文](2026-10-29-file-processing-task-model.zh.md)

## Problem

`FileProcessingService` had no async task model of its own. Its public surface was the JobManager job that ran a conversion, so both consumers read file processing through JobManager:

- `startJob` took `Pick<EnqueueOptions, 'parentId' | 'recovery'>` and returned a `JobHandle`. The IPC route `file_processing.start_job` returned a `JobSnapshot`.
- The result was `JobSnapshot.output: unknown`. Knowledge read it through `jobManager.get` and the translate page through `useJob`, and each parsed `FileProcessingJobOutput` itself. `getFileProcessingFailureMessage` and `getFileProcessingMarkdownArtifactPath` took a `JobSnapshot`.
- Knowledge read progress from `jobs.progress.${jobId}` and cancelled conversions by job id through JobManager.
- Knowledge listed FileProcessing's three internal job types to validate a snapshot. It also passed its own job as the conversion's `parentId`, and used the conversion's job id as the parent of its result-check and indexing jobs.

So a consumer depended on how FileProcessing schedules its work. FileProcessing also could not describe a state JobManager lacks. #20167 needs Knowledge to tell a file waiting for a processor slot from one being converted. The only place that difference existed was the job's status, and JobManager publishes `jobs.state.*` only on enqueue and on settle.

Restart behavior was spelled in JobManager's terms too. The three handlers declared `recovery: 'retry'`, and Knowledge overrode it with `abandon`. No consumer could use a result after a restart: Knowledge waits in memory, and the translate page keeps the task id in component state. A `background` conversion re-run at startup billed its cloud processor again for nothing.

Goal (#22987): JobManager is invisible to any service that depends on FileProcessing, unless that service uses JobManager for its own work outside file processing.

## Decision

- **Task model.** `src/shared/data/types/fileProcessing.ts` defines `FileProcessingTaskId`, a branded string, and `FileProcessingTask`, a union discriminated by `status`. Every variant carries `id`, `feature`, and `processorId`:
  - `queued`;
  - `processing`, with `progress` from 0 to 100;
  - `completed`, with a typed `artifact`;
  - `failed` and `cancelled`, each with `error`, the reason as a message.

  ```text
    startTask
        │
        ▼
     queued ───(1)───► processing ───(3)───► completed
        │                │   ▲  │
        │                │   └──┘ (2)
        │                │
        │                ├───────(4)───────► failed
        │                │
        └────────────────┴───────(5)───────► cancelled
  ```

  1. The handler's `execute` starts.
  2. The processor reports progress.
  3. The artifact is written.
  4. The processor fails, or the job times out.
  5. `cancelTask`, or the next launch cancelling a task the previous one left unfinished.

  `completed`, `failed`, and `cancelled` are final. `done` resolves once, `onDidChangeTask` reports a terminal state once, and a progress report from a conversion still stopping after its task settled is dropped. A retry starts a new task.
- **Main-process API on `FileProcessingService`.** It replaces `startJob`:
  - `startTask(input)` resolves to `{ task, done }`. `task` is the task as just queued, and `done` resolves to its terminal `FileProcessingTask`.
  - `getTask(id)` returns a task's current state, or `null` when the id is not a file-processing task.
  - `cancelTask(id, reason?)` resolves to `cancelled`; `timed-out` when the task reads `cancelled` but its conversion did not stop in time; or `not-cancellable` when the task already settled or does not exist.
  - `onDidChangeTask: Event<FileProcessingTask>` fires on every status change and progress report of every task.
- **Implementation stays on JobManager, behind the boundary.**
  - A task id is its job id internally. No consumer relies on that.
  - `startTask` publishes `queued`. Each handler is wrapped by `withTaskUpdates`, which publishes `processing` at 0 when `execute` starts and on each progress report, and the terminal state from the handler's `onSettled`. Each change fires `onDidChangeTask` and writes the shared cache key `file_processing.task.${taskId}`. A terminal entry expires after 60 seconds.
  - `getTask` maps the job row: `pending` and `delayed` read as `queued`, and `running` as `processing` with the last progress in the cache entry. The job output schema is private to FileProcessing.
  - Nothing new is persisted, and JobManager does not change.
- **Renderer.**
  - IPC `file_processing.start_task` returns a `FileProcessingTask`, and `file_processing.get_task` reads one, or `null`.
  - `useFileProcessingTask(id)` reads the cache key and falls back to `get_task` while the entry is empty.
  - The translate page uses them instead of `useJob`.
- **Restart: no task survives one, but the ability to resume is kept.**
  - All three job types declare `recovery: 'abandon'`. When FileProcessing registers its handlers, JobManager cancels every task the previous launch left unfinished, instead of resuming it or running it again. `startTask` takes no restart option.
  - `remote-poll` still records its provider task id in the job's metadata. Given a recorded id, it still polls that remote task instead of submitting a new one. A later durable consumer (#22706, Problem B) can turn resuming back on without rebuilding it.
- **Knowledge.** It uses only this API for file processing:
  - `scheduleItem` starts the conversion with `startTask` and waits on `done`. It then enqueues one `knowledge.check-file-processing-result`, whose payload names the task as `fileProcessingTaskId`. The check reads the task through `getTask`.
  - The item's progress comes from `onDidChangeTask`. A processing task's progress is copied onto the item, starting at 0 when its conversion starts. A queued task shows none.
  - Delete, replace, and base deletion cancel the tasks their items wait on through `cancelTask`.
  - Knowledge passes no `parentId` or restart option, and names no FileProcessing job type. For a direct add, the check job's own id scopes the indexing idempotency key.
- **Exports.** `startJob`, `getFileProcessingFailureMessage`, `getFileProcessingMarkdownArtifactPath`, `FileProcessingJobPayload`, and `FileProcessingJobOutput` are removed. `file_processing.start_task` replaces the IPC route `file_processing.start_job`.

This note partly supersedes [the Knowledge completion-callback note](../../proposed/architecture/2026-10-25-knowledge-file-processing-completion-callback.md). Its wait registry and single check job stand. The item now waits on a task's `done` instead of a `JobHandle`, takes progress from `onDidChangeTask` instead of a 5-second poll, and cancels through `cancelTask`.

## Alternatives considered

- **JobManager publishes `running` when it claims a job, and consumers keep reading `jobs.state.*`.** It shows when a conversion starts, but it leaves every consumer on JobManager's vocabulary, so it misses the goal.
- **FileProcessing persists its own task table.** It duplicates the job row. Without durable tasks there is nothing to put in it that the job row lacks.
- **Durable tasks now: keep `retry` and offer a `survivesRestart` option.** No consumer can read a result after a restart. Resuming would only re-bill a `background` processor, or poll a remote task whose result nobody reads.
- **Delete the resume path, since nothing uses it yet.** Rebuilding it for a durable consumer would cost more than keeping it tested.
- **Retrying a failed or cancelled task under the same id.** No consumer needs it: Knowledge's reindex and a new OCR on the translate page both start over. `done` and the terminal event would fire more than once, and a task would need a persisted mapping to its jobs. A later `retryOf` option on `startTask` could let a retry reuse the old task's remote state, for example a remote task still queued after a local timeout (#22761). It would only add to this API.
- **Change notifications on the handle only.** A consumer that comes back with just an id, which a future durable consumer would do after a restart, could not follow the task.

## Consequences

- The translate page behaves differently at a restart. An OCR interrupted by a quit is cancelled at the next launch, where it used to run again with nobody reading the result.
- A cloud conversion Knowledge started is still dropped at a restart, as it has been since #22662. That stays the case until a durable consumer exists.
- The resume path no longer runs in production. AC6's tests are what keep it working.
- Rows written by the previous version are cancelled when their handlers register: file-processing rows because their types now abandon, and Knowledge result-check rows because they already did. No old check row reaches the renamed `fileProcessingTaskId` field, so the check handler no longer handles a payload without `processedRelativePath`.
- `error` is present on `cancelled` as well as `failed`, so Knowledge fails an item with the reason either way. The Spec named it only for `failed`.
- A Knowledge item shows 0% once its conversion starts, where it used to show no percentage until the first progress report.
- Still out of scope: Knowledge's `queued` item state (#20167); durable tasks and a durable Knowledge wait (#22706); the vendor-side states #22761 asks for; removing JobManager's per-job `recovery` override and the `job.recovery` column, which lost their only caller here (#22706); correcting `useJob`'s doc.

## Verification

- AC1 — `src/main/features/fileProcessing/__tests__/FileProcessingService.tasks.test.ts` (9 cases against a real JobManager and a file-backed database): events `queued` → `processing 0` → `processing 40` → `completed` with its artifact and the same state in the cache entry; a failure with its message; cancelling a queued and a processing task; and a cancelled task staying `cancelled` when its conversion still reports progress, which fails once the abort guard in `withTaskUpdates` is removed.
- AC2 — `src/renderer/pages/translate/__tests__/TranslatePage.test.tsx` runs the real `useFileProcessingTask` against `file_processing.start_task`, `file_processing.get_task`, and the shared cache, including "reads a settled OCR task over IPC once its cache entry has expired"; `FileProcessingService.tasks.test.ts` reads a settled task from its job after the cache entry expires; `pnpm test:renderer src/renderer/pages/translate/__tests__/TranslatePage.test.tsx src/renderer/pages/knowledge/panels/dataSource` passes (8 files, 181 tests); code search finds no `useJob`, `/jobs/`, or `jobs.*` key in `src/renderer/pages/translate`.
- AC3 — `pnpm typecheck` passes; code search finds no JobManager type, status, enqueue option, or cache key in `src/main/features/fileProcessing/index.ts`, `src/main/features/fileProcessing/types.ts`, `src/shared/ipc/schemas/fileProcessing.ts`, or `src/shared/data/types/fileProcessing.ts`, and no FileProcessing job type name outside `src/main/features/fileProcessing` except the migration 0029 backfill test, which seeds rows already on disk.
- AC4 — `checkFileProcessingResultJobHandler.test.ts` (14 cases: a completed task indexed under the check job or the reindex parent, failed and cancelled tasks failing the item with the reason, a missing task, a non-markdown artifact), `FileProcessingWaitManager.test.ts` (5), `cancel.test.ts` (12, including a task cancel timing out under `throw`), `deleteSubtreeJobHandler.test.ts`, and the file-processing cases in `KnowledgeService.test.ts` (check after `done`, progress from `onDidChangeTask`, base deletion cancelling the waited task); `pnpm test:main src/main/features/fileProcessing src/main/features/knowledge src/main/ipc` passes (132 files, 1407 tests, 13 skipped).
- AC5 — `FileProcessingService.tasks.test.ts` "cancels every task the previous launch left unfinished, without converting it": leftover running and pending rows of all three job types read `cancelled` after the service initializes, and no conversion starts.
- AC6 — `src/main/features/fileProcessing/tasks/__tests__/remotePollJobHandler.test.ts` "first launch" records the whitelisted provider state through `patchMetadata` before polling, and "resume from metadata" skips `startRemote` and polls the recorded remote task.
