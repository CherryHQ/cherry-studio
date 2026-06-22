# Job & Scheduler — Architecture Overview

Two independent main-process lifecycle services:

| Service | Role | Persistence | Direct consumer |
|---|---|---|---|
| **SchedulerService** | "When to fire a callback" — cron / interval / once. Stateless. | None | JobManager + any module needing simple time scheduling |
| **JobManager** | "Job lifecycle" — registry, persistence, 6-state machine, dispatch, recovery | `jobTable` + `jobScheduleTable` | All background work |

**Layering rule**: SchedulerService is unaware of Jobs. JobManager uses SchedulerService to arm schedules. Business modules pick one based on need:

- Need cron + persistent observability + retry → register a JobHandler + use `jobManager.registerJobSchedule()`
- Need cron only (heartbeat-style, no persistence) → `schedulerService.registerSchedule()` directly
- Need recurring service-internal GC / self-check → `BaseService.registerInterval` (project convention, not SchedulerService)

## DB-driven dispatch

`jobTable` is the **single source of truth**. Memory state (handlers Map, queues Map, AbortControllers) is a derived view that JobManager rebuilds on every startup.

Each queue has a `DispatchQueue` instance holding `{ name, concurrency, mutex }`. The dispatch loop (`JobManager.dispatch`):

1. Acquire **Layer 1** per-queue mutex *first*
2. Acquire **Layer 0** global mutex *second*
3. Inside one DB transaction:
   - Count queue-active jobs → check `queue.concurrency`
   - Count globally-running jobs → check `globalMaxConcurrency`
   - SELECT next pending → UPDATE to running (claim)
4. Release both mutexes (global first, then per-queue, reverse acquisition order)
5. Spawn `handler.execute` outside the lock
6. Queue a microtask to dispatch the same queue again (fill next slot)

Spawning happens *outside* the mutex — the handler executes for seconds/minutes while new dispatches proceed.

**Lock acquisition order is fixed** (per-queue then global). All call sites use this order so the two layers cannot deadlock against each other.

## Six-state state machine

```
                  ┌── retry backoff (delayed) ──┐
                  ▼                              │
   enqueue → pending → running → completed       │
                  │       │                      │
                  │       └→ failed ─────────────┘ (if retryable && attempt < max)
                  │       └→ cancelled (terminal)
                  └→ delayed → (scheduledAt ≤ now) → pending
```

Terminal states (`completed` / `failed` / `cancelled`) are never reopened. Retry re-enters `delayed` then transitions back to `pending` when scheduledAt elapses.

## Startup Recovery

Startup recovery is JobManager's deferred sweep that reconciles the DB-driven state machine with the freshly booted process. It is service-level business work, **not** a bootstrap initialization side effect — see [onAllReady business work pattern](../lifecycle/lifecycle-usage.md#onallready-business-work-pattern) for the framework-level rationale.

**Sequence**

1. `JobManager.onAllReady()` schedules a `setTimeout` with a 60-second "quiet window" and returns synchronously. `LifecycleManager.allReady()` is fire-and-forget; bootstrap is not blocked.
2. After 60 s, the timer callback assigns the recovery flow promise to `this._recoveryDone` (only if shutdown has not been requested) and the flow starts running.
3. The flow runs four IO steps in order:
   1. `runStartupRecovery(handlers, isJobInFlight)` — resets non-terminal rows per handler recovery strategy (`abandon` / `retry` / `singleton`); `cancelRequested=true` overrides every strategy. Rows the current process is **already executing** (reported via `isJobInFlight`, backed by `JobManager.inFlightExecuted`) are excluded before any strategy, so a job enqueued during the quiet window and still running when the sweep fires is never reset or re-dispatched (#16291).
   2. **Resurrect queues** — walks distinct `(queue, type)` pairs over non-terminal rows and ensures a `DispatchQueue` exists for each. Without this step `dispatchAll` would iterate an empty `queues` map and pending rows would wait until the next `enqueue`.
   3. **Catch-up THEN arm** — calls `detectAndDispatchOverdue(schedules)` *before* `armSchedule(schedule)` for every enabled schedule. The order is load-bearing: if we armed first, a cron with `protect: true` could fire its natural calendar concurrently with a catch-up enqueue (`protect` only blocks overlapping callbacks, not external callers). Sequencing catch-up first guarantees the make-up enqueue lands before croner's first natural fire.
   4. `dispatchAll()` kicks every per-queue pump so pending rows reset by step 1 start running immediately rather than waiting on the next enqueue.

**The 60 s quiet window**

The delay (`JOB_MANAGER_STARTUP_DELAY_MS = 60_000`, hardcoded) gives cold-start IO — DB warm-up, window paints, client bootstrap — time to settle before scheduled work piles on. Tests bypass it via `vi.useFakeTimers + advanceTimersByTimeAsync(60_000)`, then await `_recoveryDone`.

**Shutdown safety — three layers**

The flow can be interrupted at any point by `onStop`. Three mechanisms cooperate:

| Window | Defence |
|---|---|
| Quiet window (timer not yet fired) | `registerDisposable(() => clearTimeout(handle))` clears the timer during `_cleanupDisposables`; the callback also re-checks `_isShuttingDown` so a teardown that races with `clearTimeout` is still safe. |
| Flow mid-flight | Every IO step re-checks `_isShuttingDown` before the next `await`, returning early on shutdown. |
| Flow already started | `onStop` awaits `this._recoveryDone` before tearing down resources, so the current step finishes gracefully before queues, abort controllers, and disposables are released. |

**Handler registration timing**

Handlers must be registered in the owning service's `onInit` (see [handler-authoring.md — Registration Timing](./handler-authoring.md#registration-timing)). By the time the 60-second timer fires every consumer has finished `onInit` / `onReady`, so `runStartupRecovery` sees the full handler set. Registering a handler from another service's `onAllReady` is unsafe: that hook runs in parallel with JobManager's, and any non-terminal job for an unregistered type during recovery gets treated as an orphan and cancelled.

## Why DB-driven and not in-memory queue?

We considered BullMQ / bee-queue / better-queue / agenda / graphile-worker / bree etc. and selected this design because:

- All persistence already in SQLite (no Redis / MongoDB / PostgreSQL dependency)
- Restart recovery is automatic — memory replays from DB
- Race safety needs only one mutex pair (Layer 0 + Layer 1) around `count → claim`
- No double-source-of-truth bookkeeping (PQueue + DB) and its sync discipline

Throughput: ~200 dispatch/s at single-process libsql throughput, well above Cherry Studio's largest scenario (1000+ knowledge bases, each with concurrency=5, never exceeds globalMaxConcurrency=50 simultaneous running jobs).

## Strongly-typed JobRegistry

Business modules use TypeScript declaration merging to register `type → payload` mapping:

```typescript
declare module '@main/core/job/jobRegistry' {
  interface JobRegistry {
    'agent.task': AgentTaskPayload
    'knowledge.index-leaf': IndexLeafPayload
  }
}
```

After this declaration:

- `jobManager.enqueue('agent.task', payload)` is compile-time type-checked
- Renaming a type surfaces every call site via the TypeScript error pipeline
- Wrong payload shape is a compile error

## Renderer-side consumers

The renderer never enqueues, cancels, or otherwise mutates jobs through the DataApi. It only observes job state read-only:

- `useJob(jobId)` → current `JobSnapshot` (status / counters / error / ...). Source: shared cache `jobs.state.${id}` with GET `/jobs/:id` as a cold-start fallback.
- `useJobProgress(jobId)` → fine-grained progress. Source: shared cache `jobs.progress.${id}` only.

Triggering a job is owned by the relevant business module in main:

1. The business service decides the semantics — which job type, what payload, queue, idempotency key, max attempts, timeout.
2. It calls `application.get('JobManager').enqueue(...)` directly.
3. If the renderer needs to initiate the work, the business module exposes a dedicated IPC route (e.g. the `knowledge.add_items` IpcApi route); the route handler internally calls `JobManager.enqueue(...)`.

This keeps `JobRegistry`'s compile-time `JobPayloadOf<K>` type safety intact and prevents the renderer from depending on JobManager infrastructure details (queue names, retry policies, idempotency keys).

## See also

- [concurrency-and-locks.md](./concurrency-and-locks.md) — The full four-layer lock model
- [handler-authoring.md](./handler-authoring.md) — How to write a handler
- [migration-checklist.md](./migration-checklist.md) — Migrating existing services
