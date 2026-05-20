# Scheduler

General-purpose stateless time scheduler: cron expressions, intervals, one-shot delays. Knows "when to fire a callback" — nothing about what the callback does.

> **Full documentation** is at [docs/references/job-and-scheduler/](../../../../docs/references/job-and-scheduler/).
> This file is a quick-reference pointer.

## Quick Links

| Topic | Reference Doc |
|-------|--------------|
| When to use SchedulerService vs `registerInterval` vs raw `setInterval` | [Scheduler Usage](../../../../docs/references/job-and-scheduler/scheduler-usage.md) |
| Architecture context (Scheduler as the lower layer under JobManager) | [Overview](../../../../docs/references/job-and-scheduler/overview.md) |

## File Structure

```
scheduler/
└── SchedulerService.ts   # @Injectable lifecycle service: registerSchedule / pause / resume / unregister / triggerNow / getNextRun
```

## Quick Start

```ts
import { application } from '@application'

const scheduler = application.get('SchedulerService')

// Cron — backed by croner; supports pause/resume/triggerNow
const disp = scheduler.registerSchedule(
  'my.cleanup',
  { kind: 'cron', expr: '0 3 * * *', timezone: 'Asia/Shanghai' },
  () => runCleanup()
)

// Interval — chained setTimeout (handles slow callbacks without overlap)
scheduler.registerSchedule('my.poll', { kind: 'interval', ms: 30_000 }, async () => poll())

// One-shot — fires once at the given epoch ms
scheduler.registerSchedule('my.delayed', { kind: 'once', at: Date.now() + 60_000 }, () => fire())

// Cleanup
disp.dispose()                    // or
scheduler.unregister('my.cleanup')
```

**No persistence** — SchedulerService re-arms nothing on startup. JobManager re-registers all `jobScheduleTable` rows on its own `onReady`. Direct consumers must re-register their schedules in their own service's `onReady`.

See [Scheduler Usage](../../../../docs/references/job-and-scheduler/scheduler-usage.md) for the full decision tree.
