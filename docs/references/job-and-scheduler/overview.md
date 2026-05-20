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

## See also

- [concurrency-and-locks.md](./concurrency-and-locks.md) — The full four-layer lock model
- [handler-authoring.md](./handler-authoring.md) — How to write a handler
- [migration-checklist.md](./migration-checklist.md) — Migrating existing services
