# Agent Note: Give FileProcessing its own task model instead of exposing JobManager jobs

Status: proposed

English | [中文](2026-10-29-file-processing-task-model.zh.md)

## Problem

`FileProcessingService` has no async task model of its own. Its public surface is the JobManager job that runs a conversion, so both consumers read file processing through JobManager:

- `startJob` takes `Pick<EnqueueOptions, 'parentId' | 'recovery'>` and returns a `JobHandle`. The IPC route `file_processing.start_job` returns a `JobSnapshot`.
- The result is `JobSnapshot.output: unknown`. Knowledge reads it through `jobManager.get` and the translate page through `useJob`, and each parses `FileProcessingJobOutput` itself. `getFileProcessingFailureMessage` and `getFileProcessingMarkdownArtifactPath` take a `JobSnapshot`.
- Knowledge reads progress from `jobs.progress.${jobId}` and cancels conversions by job id through JobManager.
- Knowledge lists FileProcessing's three internal job types to validate a snapshot. It also passes its own job as the conversion's `parentId`, and uses the conversion's job id as the parent of its result-check and indexing jobs.

So a consumer depends on how FileProcessing schedules its work. FileProcessing also cannot describe a state JobManager lacks. #20167 needs Knowledge to tell a file waiting for a processor slot from one being converted. The only place that difference exists today is the job's status, and JobManager publishes `jobs.state.*` only on enqueue and on settle.

Restart behavior is spelled in JobManager's terms too. The three handlers declare `recovery: 'retry'`, and Knowledge overrides it with `abandon`. No consumer can use a result after a restart: Knowledge waits in memory, and the translate page keeps the job id in component state. A `background` conversion that is re-run at startup bills its cloud processor again for nothing.

Goal (#22987): JobManager is invisible to any service that depends on FileProcessing, unless that service uses JobManager for its own work outside file processing.

## Proposal

- **Task model.** `src/shared/data/types/fileProcessing.ts` defines it:
  - `FileProcessingTaskId`, a branded string;
  - `FileProcessingTaskStatus`: `queued`, `processing`, `completed`, `failed`, `cancelled`;
  - `FileProcessingTask`: `id`, `feature`, `processorId`, `status`, `progress` while processing, `artifact` when completed, and `error` (a message) when failed.

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

  `completed`, `failed`, and `cancelled` are final, so `done` resolves once and `onDidChangeTask` reports a terminal state once. A retry starts a new task. A JobManager retry of a failed attempt stays inside the task and reads as `queued` while it waits, but all three job types allow one attempt today.
- **Main-process API on `FileProcessingService`.** It replaces `startJob`:
  - `startTask(input)` resolves to `{ task, done }`. `task` is the task as just queued, and `done` resolves to its terminal `FileProcessingTask`.
  - `getTask(id)` and `cancelTask(id)`.
  - `onDidChangeTask: Event<FileProcessingTask>` fires on every status change and progress report of every task. It is service-level, not per handle, so a consumer that holds only an id can follow a task.
- **Implementation stays on JobManager, behind the boundary.**
  - A task id is its job id internally. No consumer relies on that.
  - `getTask` maps the job row: `pending` and `delayed` read as `queued`, and `running` as `processing`.
  - FileProcessing publishes changes from its own code: `startTask` publishes `queued`, the handler publishes `processing` when `execute` starts and on each progress report, and the handler's `onSettled` publishes the terminal state. Each change fires `onDidChangeTask` and writes the shared cache key `file_processing.task.${taskId}`.
  - Nothing new is persisted, and JobManager does not change.
- **Renderer.**
  - IPC `file_processing.start_task` returns a `FileProcessingTask`, and `file_processing.get_task` reads one.
  - `useFileProcessingTask(id)` reads the cache key and falls back to `get_task` once the entry expires.
  - The translate page uses them instead of `useJob`.
- **Restart: no task survives one this phase, but the ability to resume is kept.**
  - All three job types declare `recovery: 'abandon'`, so startup cancels a task left from the previous launch instead of resuming it or running it again. `startTask` takes no restart option.
  - `remote-poll` still records its provider task id in the job's metadata. Given a recorded id, it still polls that remote task instead of submitting a new one. A later durable consumer (#22706, Problem B) can turn resuming back on without rebuilding it.
- **Knowledge.** It uses only this API for file processing:
  - It waits on `done`, takes progress from `onDidChangeTask`, cancels through `cancelTask`, and its result check reads `getTask`.
  - It drops the job type list and the `parentId` it passed in. Its result-check job no longer uses the conversion's id as a parent, so for a direct add the check job's own id scopes the indexing idempotency key.
- **Exports.** `getFileProcessingFailureMessage`, `getFileProcessingMarkdownArtifactPath`, and every other export that takes a `JobSnapshot` are removed or switched to `FileProcessingTask`.

Out of scope:

- Knowledge's `queued` item state (#20167), which follows this change.
- Durable tasks and a durable Knowledge wait (#22706).
- The vendor-side states #22761 asks for.
- Removing JobManager's per-job `recovery` override and the `job.recovery` column, which lose their only caller here (#22706).
- Correcting `useJob`'s doc.

## Alternatives considered

- **JobManager publishes `running` when it claims a job, and consumers keep reading `jobs.state.*`.** It shows when a conversion starts, but it leaves every consumer on JobManager's vocabulary, so it misses the goal.
- **FileProcessing persists its own task table.** It duplicates the job row. Without durable tasks this phase has nothing to put in it that the job row lacks.
- **Durable tasks now: keep `retry` and offer a `survivesRestart` option.** No consumer can read a result after a restart. Resuming would only re-bill a `background` processor, or poll a remote task whose result nobody reads.
- **Delete the resume path, since nothing uses it this phase.** Rebuilding it for a durable consumer would cost more than keeping it tested.
- **Retrying a failed or cancelled task under the same id.** No consumer needs it: Knowledge's reindex and a new OCR on the translate page both start over. `done` and the terminal event would fire more than once, and a task would need a persisted mapping to its jobs. A later `retryOf` option on `startTask` could let a retry reuse the old task's remote state, for example a remote task still queued after a local timeout (#22761). It would only add to this API.
- **Change notifications on the handle only.** A consumer that comes back with just an id, which a future durable consumer would do after a restart, could not follow the task.

## Acceptance criteria

- AC1 — A task started through `startTask` reads `queued` until its conversion starts, then `processing` with its progress, then `completed` with a typed artifact, `failed` with a message, or `cancelled`, and `onDidChangeTask` reports each change. A task in a terminal state never changes again. (verification: unit)
- AC2 — The renderer starts a task over IPC and follows it to its terminal state without `useJob`, `/jobs/:id`, or a `jobs.*` cache key, including after the live cache entry expires. (verification: unit + renderer)
- AC3 — FileProcessing's public API, IPC schema, and shared types expose no JobManager type, status, enqueue option, or cache key. Knowledge's file-processing code and the translate page reach file processing only through FileProcessing, and nothing outside FileProcessing names its job types. (verification: typecheck + code search)
- AC4 — Knowledge keeps its behavior on the new API: a converted file is indexed after its task completes, a failed or cancelled task fails the item with the reason, the item shows the task's progress, and deleting or replacing the item or deleting its base cancels the task. (verification: unit)
- AC5 — At startup, a task left non-terminal by the previous launch is cancelled for every processor, and nothing is resumed, re-run, or submitted again. (verification: unit)
- AC6 — A `remote-poll` conversion records its provider task id, and a run that finds a recorded id polls that remote task instead of submitting a new one. (verification: unit)

## Risks

- The translate page changes behavior at a restart. An OCR interrupted by a quit is cancelled at the next launch, where it used to run again with nobody reading the result.
- A cloud conversion Knowledge started is still dropped at a restart, as it has been since #22662. That stays the case until a durable consumer exists.
- The resume path no longer runs in production. AC6's tests are what keep it working.
- Rows written by the previous version are cancelled when their handlers register: file-processing rows because their types now abandon, and Knowledge result-check rows because they already did. A renamed payload field in either is never read by an old row.
