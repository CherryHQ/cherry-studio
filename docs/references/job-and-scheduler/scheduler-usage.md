# Scheduler Usage — Decision Tree

The project has three mechanisms for "fire a callback periodically / later". Picking the wrong one creates the problem the v2 unification was designed to fix: scattered ad-hoc timers with no observability and no central control.

## TL;DR table

| Need | Use |
|---|---|
| Persistent recurring background work with state machine, retry, observability | **JobManager** — `registerJobSchedule()` |
| Cron / interval / one-shot callback **across services**, no persistence | **SchedulerService** — `registerSchedule()` |
| Service-private GC / self-check / cache sweep, single interval, no observability | **`BaseService.registerInterval()`** |
| Timer that reacts to runtime state (protocol heartbeats, streaming keep-alive) | **Raw `setInterval` / `setTimeout`** inside the owning module |

## The three questions

Walk the questions in order. The first "yes" picks the mechanism.

### 1. Does the work need to survive process restart with state machine + retry + cancel?

Yes → **JobManager**. Build a `JobHandler`, register it, then call `jobManager.registerJobSchedule({ type, trigger, jobInputTemplate, catchUpPolicy })`.

You get: persistent schedule row in `jobScheduleTable`; recovery on next process start; retry backoff; user-visible status; DataApi listing; renderer progress hooks. See [handler-authoring.md](./handler-authoring.md).

### 2. Does the work fire on a cron expression OR fire across multiple services (cross-cutting timer)?

Yes → **SchedulerService**. Call `scheduler.registerSchedule(id, trigger, callback)`. Returns a `Disposable`.

You get: cron / interval / once triggers in one API; croner's pause/resume/triggerNow for cron schedules; correct timezone via Intl; auto-unrefed timers; no SQLite touches; no persistence.

Re-register in your service's `onReady` — SchedulerService does not persist anything.

### 3. Is the work a service-private internal tick (GC, expiry sweep, refresh) with no need for external observability?

Yes → **`BaseService.registerInterval()`**. Already wired into the lifecycle (auto-unref, exception isolation, auto-cleanup on `onStop` / `onDestroy`).

Why not SchedulerService here? `registerInterval` is the project convention for "service-internal implementation detail". It keeps timer ownership inside the service, which is the right scope for GC / self-check — those callbacks are not interesting to anyone else.

### 4. Otherwise: timer that reacts to runtime state.

Use raw `setInterval` / `setTimeout` inside the owning module. The classic example is a protocol heartbeat whose interval is dictated by the server's `hello` frame and may change on reconnect. SchedulerService's `Trigger` type is deliberately closed to keep its surface small — heartbeats stay outside it.

This is a **conscious design boundary**, not a deficiency. The rationale: SchedulerService accepts only declarative triggers (`cron` / `interval` / `once`); a heartbeat whose cadence is dictated by the peer is fundamentally a state-machine concern that belongs to the owning module. Forcing it through SchedulerService would require imperative reschedule APIs that pollute the simple surface.

## Common mistakes

- **Reaching for SchedulerService when `registerInterval` would suffice.** SchedulerService is for cross-cutting / cron / user-visible schedules. A service that just needs "sweep every 5 minutes for its own caches" should use `registerInterval`. SchedulerService adds nothing here and the timer becomes harder to reason about.
- **Reaching for raw `setInterval` for a cron-style cadence.** "Once per day at 03:00 in user's timezone" is what `croner` solves. Don't write a 86_400_000 ms interval — it drifts and ignores DST.
- **Building your own persistent schedule table.** The project has exactly one: `jobScheduleTable`, owned by JobManager. Need persistence? Build a JobHandler. **Hard constraint**: SchedulerService is the project's single general-purpose scheduler — every recurring task should reach time via JobManager (persistent) or SchedulerService (transient), never via a private parallel scheduler.
- **Forgetting that SchedulerService is stateless.** It does not survive restart. Re-register in `onReady` if you call it directly.

## SchedulerService internal ID conventions

JobManager owns these prefixes — third-party callers should avoid them to prevent collisions:

| Prefix | Owner | Purpose |
|---|---|---|
| `schedule:${scheduleId}` | JobManager | Repeatable schedule armed from `jobScheduleTable` |
| `job:${jobId}` | JobManager | One-shot timer for a `delayed` job's `scheduledAt` |
| `retry:${jobId}:${nextAttempt}` | JobManager | Retry backoff timer (attempt number prevents same-jobId collision) |

When a business module uses SchedulerService directly, pick a namespaced id (e.g. `myservice.cleanup`) to avoid collision with future JobManager prefixes.
