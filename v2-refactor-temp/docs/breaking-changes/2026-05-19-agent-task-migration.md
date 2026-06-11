---
title: Agent task migrated to JobManager — IPC shape changes and run-log history dropped
category: changed
severity: notice
introduced_in_pr: TBD
date: 2026-05-19
---

## What changed

Three buckets of changes ship together as part of the agent-task → JobManager
migration:

### 1. v1 run-log history not migrated

`agent_task_run_log` rows from a v1 install are not migrated. v1 users upgrading
lose visibility of historical scheduled-task executions. Future runs are
visible in the task history view (driven by `jobTable WHERE scheduleId = ?`).

### 2. Per-attempt visibility ends

Each scheduled run is now represented by exactly one row in the new job system.
Retries within a single run reuse that row (attempt counter increments). v1's
"every attempt is a separate visible entry" UX is gone.

### 3. IPC shape changes (renderer + any external IPC consumer must update)

| Old (v1) | New (v2) | Notes |
|---|---|---|
| `ScheduledTaskEntity.scheduleType + scheduleValue` (two flat strings) | `ScheduledTaskEntity.trigger: Trigger` (discriminated union: `{kind:'cron',expr,timezone?,limit?}` \| `{kind:'interval',ms}` \| `{kind:'once',at}`) | Aligns with `jobScheduleTable.trigger` shape; cron field is **`expr`** (per CronTriggerSchema), not `cron`; interval is in **`ms`**, not minutes; once carries `at` as **ms epoch**, not ISO string. |
| `CreateTaskDto.scheduleType + scheduleValue` | `CreateTaskDto.trigger` | Same shape change. |
| `CreateTaskDto.name: z.string().min(1)` | `CreateTaskDto.name: JobScheduleNameAtomSchema` | Stricter — also rejects `'   '`, control chars (NUL/TAB/LF/CR), and the `'__'` prefix (reserved for system schedules). |
| `TaskRunLogEntity.taskId` | `TaskRunLogEntity.scheduleId` | Terminology aligned with `jobTable.scheduleId`. |
| `TaskRunLogEntity.runAt: z.string()` ISO | `TaskRunLogEntity.startedAt: z.string()` ISO | Field rename only; type stays ISO string (per project IPC convention). |
| `TaskRunLogEntity.status: 'running' \| 'success' \| 'error'` | `TaskRunLogEntity.status: 'running' \| 'completed' \| 'failed' \| 'cancelled'` | Aligned with JobStatus terminal set + a new `cancelled` value (previously hidden). |
| `UpdateTaskDto.status: 'active' \| 'paused' \| 'completed'` | `UpdateTaskDto.enabled: boolean` (optional) | `completed` was a derived state users could never legitimately set; pause/resume now uses `enabled` directly. |
| (output-only) `ScheduledTaskEntity.status` derived | unchanged + new `ScheduledTaskEntity.enabled: boolean` | Output keeps UI-friendly `status` for backward visual compatibility; the new `enabled` flag is the true source of truth for pause/resume. |
| `ScheduledTaskEntity.lastResult` | (dropped) | Per-task "last result" preview was a v1-only column. The same information lives in `jobTable.output` for the latest completed run and is surfaced through `/agents/:agentId/tasks/:taskId/logs`. |

Semantic note on `TaskRunLogEntity.status` collapse: `jobTable` carries six
states (`pending`, `delayed`, `running`, `completed`, `failed`, `cancelled`).
The run-log entity collapses `pending` and `delayed` into `running` for
display — UI sees "task is in flight" without distinguishing "queued, not yet
dispatched" from "actually executing." Tools that poll `jobTable` directly
keep full fidelity.

## Why this matters to the user

- Renderer code must update field access (`task.scheduleType` →
  `task.trigger.kind`; cron expression is `task.trigger.expr`, not
  `task.trigger.cron`; interval is in `ms`, not minutes; once carries a
  number millisecond timestamp, not an ISO string).
- Any third-party IPC consumer (for example, an external automation script
  using DataApi) needs the same updates.
- The new `cancelled` value in `TaskRunLogEntity.status` should be surfaced
  in any UI filter or table-column rendering.
- The `lastResult` preview on the task card is gone — point to the run
  history list for "what happened last time" UX.

## What the user should do

Nothing manual — the bundled UI in v2 is already updated. v1 users will see
their `cron`/`interval`/`once` task configuration carried forward into v2,
but the history list will be empty until the task runs at least once under
v2.
