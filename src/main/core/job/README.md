# Job

Unified background-job system: typed handlers, DB-driven dispatch, 6-state machine, restart recovery, retry backoff, schedule registry. Built on `SchedulerService` for time triggers.

> **Full documentation** is at [docs/references/job-and-scheduler/](../../../../docs/references/job-and-scheduler/).
> This file is a quick-reference pointer.

## Quick Links

| Topic | Reference Doc |
|-------|--------------|
| Architecture, two-service separation, DB-driven dispatch | [Overview](../../../../docs/references/job-and-scheduler/overview.md) |
| Startup recovery (60 s quiet window, mid-flight shutdown safety) | [Startup Recovery](../../../../docs/references/job-and-scheduler/overview.md#startup-recovery) |
| Four-layer lock model + business-level resource locks | [Concurrency & Locks](../../../../docs/references/job-and-scheduler/concurrency-and-locks.md) |
| How to write a JobHandler (recovery / retry / catch-up / progress) | [Handler Authoring](../../../../docs/references/job-and-scheduler/handler-authoring.md) |
| Migrating existing services | [Migration Checklist](../../../../docs/references/job-and-scheduler/migration-checklist.md) |
| `SchedulerService` vs `BaseService.registerInterval` vs `setInterval` | [Scheduler Usage](../../../../docs/references/job-and-scheduler/scheduler-usage.md) |

## File Structure

```
job/
├── JobManager.ts        # @Injectable lifecycle service: enqueue, dispatch, schedule registry, GC
├── jobRegistry.ts       # Compile-time `interface JobRegistry` — business modules extend via declaration merging
├── types.ts             # JobHandler, JobContext, EnqueueOptions, JobHandle, cache key prefixes
├── runtime/
│   ├── DispatchQueue.ts # Per-queue mutex + concurrency cap (Layer 1)
│   ├── recovery.ts      # Per-processor declarative recovery (abandon / retry / singleton)
│   └── catchUp.ts       # Schedule miss-detection (skip-missed / after-startup policies)
└── __tests__/           # Unit + integration + smoke tests
```

## Type Registration (consumers)

```ts
// In your business module:
declare module '@main/core/job/jobRegistry' {
  interface JobRegistry {
    'my.task': { itemId: string }
  }
}

jobManager.registerHandler('my.task', {
  recovery: 'retry',
  async execute(ctx) { /* ... */ }
})

await jobManager.enqueue('my.task', { itemId: '42' })
```

See [Handler Authoring](../../../../docs/references/job-and-scheduler/handler-authoring.md) for the full handler contract.

## Renderer Boundary

The renderer observes job state read-only via `useJob` / `useJobProgress` (shared cache + GET `/jobs/:id`). Triggering a job is decided in main by the owning business service, which calls `jobManager.enqueue(...)` directly; renderer-initiated triggering goes through a dedicated IPC route (e.g. the `knowledge.add_items` IpcApi route, whose main handler enqueues the index job). See [overview.md — Renderer-side consumers](../../../../docs/references/job-and-scheduler/overview.md#renderer-side-consumers).
