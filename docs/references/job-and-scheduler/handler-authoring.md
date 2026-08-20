---
description: Writing a JobHandler — onInit registration timing, minimal echo example, and JobRegistry type binding
sources:
  - src/main/core/job/JobManager.ts
  - src/main/core/job/jobRegistry.ts
---

# Handler Authoring

Further worked examples (retry / singleton recovery, failure-rate breaker, business-level mutex) are added as real consumers migrate — speculative examples bit-rot before anyone uses them.

## Registration timing

Handlers MUST be registered in the owning service's `onInit`. JobManager's [Startup Recovery](./overview.md#startup-recovery) is scheduled inside JobManager's own `onAllReady` and walks `this.handlers` when the 60-second quiet window expires. `onInit` is the lifecycle boundary that guarantees the registry is complete before any `onAllReady` hook is invoked.

`onInit` runs during phase initialization, which the framework completes for every service *before* it starts invoking any `onAllReady` hook. So a registration inside `onInit` is guaranteed to be in `this.handlers` by the time JobManager schedules recovery, regardless of phase or service order.

```typescript
// ✅ Correct — onInit finishes for every service before any onAllReady fires.
protected override async onInit(): Promise<void> {
  this.registerIpcHandlers()
  application.get('JobManager').registerHandler('agent.task', agentTaskJobHandler)
}

// ❌ Unsafe — LifecycleManager does not await onAllReady promises. Any await
//             or deferred preparation can cross JobManager's recovery timer.
protected override async onAllReady(): Promise<void> {
  await prepareHandler()
  application.get('JobManager').registerHandler('agent.task', agentTaskJobHandler)
}
```

A purely synchronous `onAllReady` body currently runs on the same tick and will normally beat the 60-second timer, but that is timing, not the framework contract: `LifecycleManager.allReady()` does not await hook completion. Registering in `onInit` remains the enforceable rule and survives later async preparation or a change to the quiet-window duration. A late registration does not throw at registration time; recovery may already have classified that type's non-terminal rows as orphaned and cancelled them.

## 1. dummy.echo (minimal handler)

```typescript
import { application } from '@application'

declare module '@main/core/job/jobRegistry' {
  interface JobRegistry {
    'dummy.echo': { message: string }
  }
}

application.get('JobManager').registerHandler('dummy.echo', {
  recovery: 'abandon',
  defaultConcurrency: 1,
  defaultTimeoutMs: 5000,
  async execute(ctx) {
    ctx.logger.info('echo start', { message: ctx.input.message })
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, 1000)
      ctx.signal.addEventListener('abort', () => {
        clearTimeout(t)
        reject(new Error('aborted'))
      })
    })
    ctx.reportProgress(100, { stage: 'done' })
    return `echo: ${ctx.input.message}`
  }
})
```

## 2. Remote-poll pattern (cross-restart hand-off)

```typescript
async execute(ctx: JobContext<RemotePollInput>): Promise<RemoteResult> {
  let providerTaskId = ctx.metadata.providerTaskId as string | undefined
  if (!providerTaskId) {
    providerTaskId = await startRemote(ctx.input, { signal: ctx.signal })
    // CRITICAL: await — without persistence the restart-recovery will re-submit
    // the remote job, wasting user quota and producing parallel external tasks.
    await ctx.patchMetadata({ providerTaskId })
  }
  while (!ctx.signal.aborted) {
    const status = await pollRemote(providerTaskId, { signal: ctx.signal })
    if (status.done) return status.result
    ctx.reportProgress(status.percent, { stage: status.stage })
    await sleep(POLL_INTERVAL_MS, { signal: ctx.signal })
  }
  throw new Error('AbortError: cancelled')
}
```

Anti-pattern: `while (true)` (cannot be cancelled), `await sleep(N)` without signal (delays cancellation by up to N ms).

### Job metadata vs schedule metadata

`ctx.metadata` / `ctx.patchMetadata` are scoped to **one job row** and die with it (terminal jobs are GC'd). Schedule-owned state that must survive across fires belongs on the **schedule** row's own `metadata` column instead — ask the schedule's command owner to write it with a read-merge-write inside `withWriteTx` (`updateJobScheduleTx` replaces the column wholesale, and a concurrent user edit can race). `agent.task`'s `metadata.reuse.revision` is one example: it is a configuration epoch used to fence jobs queued under older settings. Keep runtime-produced state out of `jobInputTemplate`: that is command-owned input; only the owner may update its configuration snapshots.

Generic metadata is not a substitute for a domain relationship. A stable reference to an entity owned by another domain must be maintained through lifecycle APIs owned by that entity's service, with database constraints when the relationship topology permits. When constraints would create circular foreign keys, follow the application-level [soft-reference pattern](../data/database-patterns.md#circular-foreign-key-references) instead. For example, the non-circular `agent.task` sticky-session relationship uses the constrained `agent_session.taskScheduleId` relation maintained by `AgentSessionService`, not a session id in schedule metadata.

## Settled event (`onSettled`)

`onSettled?(event: JobSettledEvent<TPayload>)` fires once when a job reaches a terminal state (errors are caught + logged, never propagated). The event is a projection of the persisted terminal snapshot — no `jobService.getById` reverse lookup needed:

| Field | Type | Notes |
|---|---|---|
| `jobId` | `string` | |
| `type` | `string` | |
| `scheduleId` | `string \| null` | Set when the job came from a schedule fire |
| `parentId` | `string \| null` | `opts.parentId` at enqueue; `null` for root jobs |
| `status` | `'completed' \| 'failed' \| 'cancelled'` | |
| `input` | `TPayload` | Persisted input payload, typed via the handler registration |
| `output` | `unknown` (optional) | Handler return value on `completed` |
| `error` | `JobError \| null` | |
| `attempt` | `number` | |
| `metadata` | `Readonly<Record<string, unknown>>` | Final value — includes every `patchMetadata` merge |

`JobContext` exposes the same row-level parent linkage during execution: `ctx.parentId` is `opts.parentId` at enqueue, or `null` for root jobs.

## 3. Schedule identity: `(type, name)` model

A schedule row in `jobScheduleTable` is identified by the pair `(type, name)`. A `type` can host any number of **named** schedules plus at most one **singleton** (unnamed). The `(type, name)` pair is DB-unique.

### External vs internal representation

| Layer | Singleton `name` | Named `name` |
|---|---|---|
| External API (DTO / snapshot) | `null` | non-empty `string` |
| DB column (`job_schedule.name`) | `''` (sentinel) | non-empty `string` |
| Renderer / handler code | always read `null` | non-empty `string` |

`JobScheduleService.rowToSnapshot` does the `'' → null` boundary mapping on read, and `create`/`update` do `null → ''` on write. Consumers never see the sentinel.

### `name` validity (`JobScheduleNameAtomSchema`)

Length 1-200, trimmed, no control characters (NUL/TAB/LF/CR), no `__` prefix (reserved for system schedules). External callers passing `''` (or a name violating any rule) get `JOB_SCHEDULE_NAME_INVALID`.

### by-name API resolution

`pauseJobSchedule(type, name?)` (and its `resume` / `triggerNow` / `unregister` siblings) accept `name?: string | null`:

| Input | Behavior |
|---|---|
| Non-empty `string` | Look up `(type, name)`; not found → `JOB_SCHEDULE_NOT_FOUND_BY_NAME` |
| `null` / `undefined` | If the type has exactly **one** row total, resolve to it. If **two or more**, throw `JOB_SCHEDULE_NAME_REQUIRED`. If **zero**, throw `JOB_SCHEDULE_NOT_FOUND_BY_NAME` |

Pass an explicit name on multi-instance types — relying on "exactly one row" auto-resolution is brittle when a sibling schedule appears later.

## 4. recovery × catchUpPolicy matrix (6 cells)

| Recovery × CatchUp | `skip-missed` | `after-startup` |
|---|---|---|
| **abandon** | Pre-existing non-terminal jobs → cancelled on startup. Missed schedule fires emit `onMissed` (observability) but enqueue nothing. | Same as left, PLUS enqueue make-up job after `minutes * 60_000` ms delay. |
| **retry** | running → pending on startup; delayed kept as-is. Missed fires emit `onMissed` only. | Same as left, PLUS enqueue make-up after N min. |
| **singleton** | Keep newest non-terminal, cancel the rest. Missed fires emit `onMissed` only. | Same as left, PLUS enqueue make-up after N min (joins the single-instance slot when free). |

### Recovery internals

A few invariants govern recovery decisions; the matrix above abstracts over them, but consumers occasionally need to debug startup behaviour and these knobs surface in logs and tests.

- **`singleton` keeps the *newest* row, not the oldest.** Rows are ordered `createdAt DESC`; the head is kept (`running` rows are reset to `pending`), the tail is cancelled. Consequence: a long-running singleton interrupted by a crash will be resumed (after `recovery: 'retry'`/`'singleton'` reset) rather than restarted, while stragglers from earlier runs get cleaned up. There is no "oldest wins" tiebreaker.
- **`cancelRequested=true` overrides every strategy.** A row with the cancel flag set is always cancelled at startup, regardless of `recovery`, `singleton`, or whether it was running / pending / delayed. This protects against process crashes that interrupted a cancellation in-flight — the user's intent persists across the restart.
- **In-flight rows are never touched by recovery.** Everything above describes *prior-process* leftovers. A job the **current** process is still executing (tracked in `JobManager.inFlightExecuted`) is excluded before any strategy or the `cancelRequested` override, so it is neither reset/re-dispatched (`retry` / `singleton`) nor cancelled mid-flight (`abandon` / `cancelRequested`) — this prevents a job started during the startup quiet window from running twice (#16291). The exclusion is scoped to the current process: crash leftovers from a previous process are not in that set and recover normally.
- **`isScheduleOverdue` has three branches** (relevant when picking `catchUpPolicy: 'after-startup'`):
  - **`cron`** triggers compare `nextRun ≤ now()` from the persisted column.
  - **`interval`** triggers compare `lastRun + intervalMs ≤ now()` (SchedulerService does not maintain `nextRun` for interval schedules — `lastRun` is the canonical anchor).
  - **`once`** triggers are never considered overdue: the timer is either still pending (it will fire) or has already fired and the schedule has self-cleaned. Make-up enqueues for `once` would double-fire, so the branch returns `false` unconditionally. Startup recovery enforces the complementary invariant: natural `once` fires persist `lastRun` clamped to no earlier than `trigger.at` (the once timer elapses on the monotonic clock, so an unclamped wall-clock read can land at `at - 1`), and `armSchedule` skips rows with `lastRun >= trigger.at` instead of re-arming them, while a never-fired past-due `once` still re-arms and fires immediately. This is a recovery-side guard, not strict exactly-once delivery — a crash between a fire's enqueue and its `markFired` write can still replay the one-shot on the next startup.

## 5. Error codes

Constants live in `JOB_ERROR_CODES` at `src/shared/data/api/schemas/jobs.ts` and are thrown by `JobManager` / `JobScheduleService`. The persisted `JobSnapshot.error.code` is the machine-readable contract; a domain UI may branch on it or provide its own localized presentation. There is no generic renderer error-code mapper today.

| Code | Origin | Retryable | Meaning |
|---|---|---|---|
| `JOB_UNKNOWN_TYPE` | enqueue | no | No handler registered for this type |
| `JOB_PAYLOAD_TOO_LARGE` | enqueue | no | Input JSON exceeds 1MB |
| `JOB_CANCEL_REASON_TOO_LONG` | cancel | no | Cancel reason exceeds 500 chars |
| `JOB_SCHEDULE_NOT_FOUND_BY_NAME` | schedule by-name API | no | Provided (type, name) does not exist |
| `JOB_SCHEDULE_NAME_REQUIRED` | schedule by-name API | no | Multi-instance type but no name passed |
| `JOB_SCHEDULE_NAME_INVALID` | schedule create/update | no | Name violates `JobScheduleNameAtomSchema` (empty / `__` prefix / control char / not trimmed / >200 chars) |
| `JOB_SCHEDULE_NAME_CONFLICT` | schedule create/update | no | (type, name) already exists |
| `JOB_SCHEDULE_SINGLETON_EXISTS` | schedule create | no | Unnamed schedule attempted on a type that already has a singleton |
| `JOB_SCHEDULE_TRIGGER_INVALID` | schedule create/update (`*Tx`) | no | Trigger fails scheduling semantics (cron/timezone parse, delay over the timer limit) |
| `JOB_HANDLER_TIMEOUT` | runtime | yes | Handler exceeded `timeoutMs` |
| `JOB_HANDLER_THREW` | runtime | yes | Handler threw a non-abort error |
| `JOB_CANCELLED` | recovery / cancel | no | Job cancelled by user, recovery, or shutdown |

### Timeout sentinel

`JOB_HANDLER_TIMEOUT` is dispatched by aborting the handler's `AbortController` with a `JobHandlerTimeoutError` sentinel (a dedicated `Error` subclass), not by matching the message string. This means a handler that throws a plain `new Error('request timeout')` is classified as `JOB_HANDLER_THREW`, not `JOB_HANDLER_TIMEOUT` — the dispatcher only trusts the abort reason, not text. Consumers therefore don't need to worry about accidentally triggering the "timeout" branch when their own error happens to mention the word.

## 6. Handler organization convention

Business job handlers live with the owning business module, normally under a dedicated `tasks/` sub-directory. Function/handler-object modules use a camelCase `JobHandler.ts` suffix:

```
src/main/features/knowledge/tasks/prepareRootJobHandler.ts
src/main/features/fileProcessing/tasks/remotePollJobHandler.ts
src/main/services/file/tasks/contentHashBackfillJobHandler.ts
```

| Aspect | Convention |
|---|---|
| Location | `<module>/tasks/<name>JobHandler.ts` (or the owning module root when it is already a narrow handler module, such as `ai/agents/agentTaskJobHandler.ts`) |
| Export | Named handler object or named `create...JobHandler` factory |
| Co-located test | the owning module's `__tests__/<name>JobHandler.test.ts` |

### Why "inside each business module" instead of `core/job/handlers/`

- Handlers are tightly coupled to business domain knowledge (payload, recovery strategy, and resource ownership). Co-locating them with the owning service matches ownership boundaries.
- `registerHandler` must be called from the business service's `onInit` so the handler is in place before startup recovery (see [Registration timing](#registration-timing)). Keeping the implementation file next to the registration call site reads more naturally.
- `src/main/core/job/` stays a pure framework module, free of business code.
