---
description: Entry point for the job and scheduler docs — doc map and quick navigation for JobManager and SchedulerService
sources:
  - src/main/core/job
  - src/main/core/scheduler
---

# Job & Scheduler

Cherry Studio unified background job + time-scheduling system.

| Doc | What it covers | Audience |
|---|---|---|
| [overview.md](./overview.md) | Architecture, two-service separation, DB-driven dispatch | New contributors |
| [scheduler-usage.md](./scheduler-usage.md) | Decision tree: SchedulerService vs `registerInterval` vs raw `setInterval` | All consumers |
| [concurrency-and-locks.md](./concurrency-and-locks.md) | Four-layer lock model + business-level resource locks | Handler authors |
| [handler-authoring.md](./handler-authoring.md) | How to write a JobHandler (recovery / retry / catchUp / progress) | Handler authors |
| [migration-checklist.md](./migration-checklist.md) | Step-by-step checklist for migrating existing services | Service migrators |

## Quick navigation

- Need to enqueue background work? → see [overview.md / "When to use JobManager"](./overview.md)
- Need to schedule a callback (cron / interval / one-shot)? → see [scheduler-usage.md](./scheduler-usage.md)
- Migrating from a custom queue? → see [migration-checklist.md](./migration-checklist.md)
- Handler tripping over concurrent base writes? → see [concurrency-and-locks.md](./concurrency-and-locks.md)
- How does startup recovery work (60 s quiet window, mid-flight shutdown)? → see [overview.md / Startup Recovery](./overview.md#startup-recovery)
- Where do handlers get registered, and why is fire-and-forget `onAllReady` not a registration boundary? → see [handler-authoring.md / Registration timing](./handler-authoring.md#registration-timing)
