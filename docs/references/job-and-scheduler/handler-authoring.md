# Handler Authoring

Phase 1 ship guarantees this doc has five sections. Further worked examples (retry / singleton recovery, failure-rate breaker, business-level mutex) are backported during Phase 2-4 business migrations to avoid speculative code that bit-rots before a real consumer appears.

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

## 5. Error codes (renderer maps via i18next)

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

