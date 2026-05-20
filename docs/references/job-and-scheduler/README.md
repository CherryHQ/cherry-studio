# Job & Scheduler

Cherry Studio unified background job + time-scheduling system. Phase 1 (basic infrastructure) is implemented; business migrations (agent task, FileProcessing, Knowledge) are scheduled for Phase 2-4.

| Doc | What it covers | Audience |
|---|---|---|
| [overview.md](./overview.md) | Architecture, two-service separation, DB-driven dispatch | New contributors |
| [scheduler-usage.md](./scheduler-usage.md) | Decision tree: SchedulerService vs `registerInterval` vs raw `setInterval` | All consumers |
| [concurrency-and-locks.md](./concurrency-and-locks.md) | Four-layer lock model + business-level resource locks | Handler authors |
| [handler-authoring.md](./handler-authoring.md) | How to write a JobHandler (recovery / retry / catchUp / progress) | Handler authors |
| [migration-checklist.md](./migration-checklist.md) | Step-by-step checklist for migrating existing services | Phase 2-4 migrators |

## Quick navigation

- Need to enqueue background work? → see [overview.md / "When to use JobManager"](./overview.md)
- Need to schedule a callback (cron / interval / one-shot)? → see [scheduler-usage.md](./scheduler-usage.md)
- Migrating from a custom queue? → see [migration-checklist.md](./migration-checklist.md)
- Handler tripping over concurrent base writes? → see [concurrency-and-locks.md](./concurrency-and-locks.md)
