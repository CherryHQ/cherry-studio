# CherryClaw Scheduler

CherryClaw's scheduler uses a nanoclaw-inspired task-based polling design. The database is the single source of truth — no in-memory timer state is needed, and the system auto-recovers after app restart.

## Architecture

```
SchedulerService (singleton, polling loop)
  startLoop()
    → Execute tick() every 60s
      → taskService.getDueTasks()
        → SELECT * FROM scheduled_tasks WHERE status='active' AND next_run <= now()
      → For each due task, call runTask(task) (fire-and-forget)

  runTask(task)
    1. Load agent configuration
    2. Read heartbeat file, prepend to task prompt (optional)
    3. Find or create session based on context_mode
    4. sessionMessageService.createSessionMessage({ persist: true })
    5. Drain stream and wait for completion
    6. Log run to task_run_logs
    7. computeNextRun() to calculate next run time
    8. Send task completion/failure notification via channels (optional)

  stopLoop()
    → Clear timer, abort all running tasks
```

## Schedule Types

| Type | `schedule_value` Format | Description |
|---|---|---|
| `cron` | Cron expression, e.g., `0 9 * * 1-5` | Standard cron scheduling (using cron-parser v5) |
| `interval` | Minutes, e.g., `30` | Fixed interval execution |
| `once` | ISO 8601 timestamp | One-time task, auto-marked as completed after execution |

## Drift-proof Interval Calculation

`computeNextRun()` anchors to the previous `next_run` timestamp, not the current time. If multiple intervals were missed (e.g., during app shutdown), it skips past expired intervals to calculate the next future time point:

```typescript
// Anchor to scheduled time to prevent cumulative drift
let next = new Date(task.next_run).getTime() + intervalMs
while (next <= now) {
  next += intervalMs
}
```

This ensures interval scheduling doesn't accumulate drift from task execution time or polling delays.

## Context Modes

Each task can configure `context_mode`:

| Mode | Behavior |
|---|---|
| `session` | Reuse existing session, maintaining multi-turn conversation context |
| `isolated` | Create a new session each execution, no history context |

When using `session` mode, `SessionMessageService` captures the SDK's `session_id` (from the `system/init` message) and persists it as `agent_session_id`. On the next run, it's passed as `options.resume`, enabling cross-execution conversation continuity.

## Heartbeat File

If an agent has `heartbeat_enabled: true`, the scheduler reads the heartbeat file (path specified by `heartbeat_file` config) before task execution and prepends it as context to the task prompt:

```
[Heartbeat]
{heartbeat file content}

[Task]
{task prompt}
```

`HeartbeatReader` includes path traversal protection, ensuring the heartbeat file path cannot escape the workspace directory.

## Consecutive Error Handling

The scheduler tracks consecutive error counts per task. After 3 consecutive failures, the task is automatically paused (`status: 'paused'`). The error count resets on the next successful run. This state is tracked in memory, not persisted.

## Task Completion Notifications

After each task run, `notifyTaskResult()` sends a status message to all channels with `is_notify_receiver` enabled:

```
[Task completed] Task Name
Duration: 12s
```

Or on failure:

```
[Task failed] Task Name
Duration: 5s
Error: error message
```

Notifications are sent fire-and-forget, not blocking the scheduling loop.

## Manual Triggering

Besides automatic scheduling, each task can be manually triggered via API or UI:

- API: `POST /v1/agents/:agentId/tasks/:taskId/run`
- UI: "Run" button in the task settings list

`runTaskNow()` validates the task exists and isn't already running (returns 409 for duplicates), then triggers execution in the background.

## Backward Compatibility

`startScheduler(agent)` and `stopScheduler(agentId)` are preserved as no-ops for compatibility with existing agent handler code. All scheduling logic is driven by the polling loop through database state.

## Key Files

| File | Description |
|---|---|
| `src/main/services/agents/services/SchedulerService.ts` | Polling scheduler main logic |
| `src/main/services/agents/services/TaskService.ts` | Task CRUD, getDueTasks, computeNextRun |
| `src/main/services/agents/database/schema/tasks.schema.ts` | scheduled_tasks + task_run_logs table definitions |
| `resources/database/drizzle/0003_wise_meltdown.sql` | Database migration script |
