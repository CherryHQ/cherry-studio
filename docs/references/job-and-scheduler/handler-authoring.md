# Handler Authoring

Phase 1 ship guarantees this doc has five sections. Further worked examples (retry / singleton recovery, failure-rate breaker, business-level mutex) are backported during Phase 2-4 business migrations to avoid speculative code that bit-rots before a real consumer appears.

## Registration timing

Handlers MUST be registered in the owning service's `onInit`. JobManager's [Startup Recovery](./overview.md#startup-recovery) is scheduled inside JobManager's own `onAllReady` (a `setTimeout` whose 60 s "quiet window" then expires) and walks `this.handlers` when the timer fires. **What matters is not the 60 s — it's whether your registration happens before or after JobManager's `onAllReady` hook is invoked.**

`onInit` runs during phase initialization, which the framework completes for every service *before* it starts invoking any `onAllReady` hook. So a registration inside `onInit` is guaranteed to be in `this.handlers` by the time JobManager schedules recovery, regardless of phase or service order.

```typescript
// ✅ Correct — onInit finishes for every service before any onAllReady fires.
protected override async onInit(): Promise<void> {
  this.registerIpcHandlers()
  application.get('JobManager').registerHandler('agent.task', agentTaskJobHandler)
}

// ❌ Unsafe — your onAllReady fires in parallel with JobManager's. Whether
//             your registerHandler lands before JobManager schedules its
//             setTimeout is undefined order. Even if you "win" the race, no
//             future code change can rely on it; reviewers will assume the
//             registry was complete by the start of `allReady`.
protected override onAllReady(): void {
  application.get('JobManager').registerHandler('agent.task', agentTaskJobHandler)
}
```

The race is not about the 60 s being "not enough" — by the time the timer fires, every service's `onAllReady` synchronous body has long since run. The race is about **the registration's position relative to JobManager's `onAllReady` scheduling the timer**. Registering in `onInit` puts you before `allReady` even starts; registering in `onAllReady` puts you in an unordered set of peer hooks. The framework cannot enforce this — registration in `onAllReady` will not throw, it will just leak non-terminal rows of unregistered types to `cancelled` whenever JobManager observes the registry first.

## 1. dummy.echo (minimal handler)

```typescript
import { jobManager } from '@main/core/job/JobManager'

declare module '@main/core/job/jobRegistry' {
  interface JobRegistry {
    'dummy.echo': { message: string }
  }
}

jobManager.registerHandler('dummy.echo', {
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
- **`isScheduleOverdue` has three branches** (relevant when picking `catchUpPolicy: 'after-startup'`):
  - **`cron`** triggers compare `nextRun ≤ now()` from the persisted column.
  - **`interval`** triggers compare `lastRun + intervalMs ≤ now()` (SchedulerService does not maintain `nextRun` for interval schedules — `lastRun` is the canonical anchor).
  - **`once`** triggers are never considered overdue: the timer is either still pending (it will fire) or has already fired and the schedule has self-cleaned. Make-up enqueues for `once` would double-fire, so the branch returns `false` unconditionally.

## 5. Error codes (renderer maps via i18next)

Constants live at `src/main/core/job/errorCodes.ts` and are thrown by `JobManager` / `JobScheduleService`. Renderer reads the `code` string off `JobSnapshot.error`.

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
| `JOB_HANDLER_TIMEOUT` | runtime | yes | Handler exceeded `timeoutMs` |
| `JOB_HANDLER_THREW` | runtime | yes | Handler threw a non-abort error |
| `JOB_CANCELLED` | recovery / cancel | no | Job cancelled by user, recovery, or shutdown |

Renderer: `t(\`errors.jobs.${code.toLowerCase()}\`, params)`.

### Timeout sentinel

`JOB_HANDLER_TIMEOUT` is dispatched by aborting the handler's `AbortController` with a `JobHandlerTimeoutError` sentinel (a dedicated `Error` subclass), not by matching the message string. This means a handler that throws a plain `new Error('request timeout')` is classified as `JOB_HANDLER_THREW`, not `JOB_HANDLER_TIMEOUT` — the dispatcher only trusts the abort reason, not text. Consumers therefore don't need to worry about accidentally triggering the "timeout" branch when their own error happens to mention the word.

## 6. Handler organization convention

Business job handlers live inside the owning business module under a dedicated `tasks/` sub-directory. File names use a `JobHandler.ts` suffix:

```
src/main/services/knowledge/tasks/PrepareRootJobHandler.ts
src/main/services/knowledge/tasks/IndexLeafJobHandler.ts
```

| Aspect | Convention |
|---|---|
| Location | `<module>/tasks/<Name>JobHandler.ts` |
| Default export | Same name as the file (class or const handler object both fine) |
| Co-located test | `<module>/tasks/__tests__/<Name>JobHandler.test.ts` |

### Why "inside each business module" instead of `core/job/handlers/`

- Handlers are tightly coupled to business domain knowledge (input/output schema, `recovery` strategy, `catchUpPolicy` are all defined by the business). Co-locating them with the owning service matches ownership boundaries.
- `registerHandler` must be called from the business service's `onInit` so the handler is in place before `JobManager.onAllReady`'s startup recovery (§4). Keeping the implementation file next to the registration call site reads more naturally.
- `src/main/core/job/` stays a pure framework module, free of business code.

### Applicability

| Scenario | Required |
|---|---|
| First batch of handlers (file-processing, knowledge, agent-task) | ✅ Yes |
| All new handlers added later | ✅ Yes |
| Experimental handlers (not in `JobRegistry`) | ⚠ Recommended, not blocking |
| Pre-existing handlers, if any | Migrate opportunistically when touching nearby code |

