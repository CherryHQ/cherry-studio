# Scheduled Task Run Status Design

**Date:** 2026-08-12

## Problem

The scheduled-task overview currently exposes only schedule state (`active`, `paused`, or `completed`). It does not tell users whether a task is executing now or how its most recent execution ended. The removed v1 header card showed schedule metadata and last/next run times, but it did not expose the underlying Job execution state, so restoring it would not answer this feedback.

## Goals

- Show a compact execution summary on every scheduled-task overview card that has run at least once.
- Keep schedule state and execution state visually and semantically separate.
- Reuse the existing Job lifecycle and task-run history as the source of truth.
- Let users open the relevant history entry directly from the execution summary.
- Keep the overview synchronized when a scheduled Agent task starts or settles.

## Non-goals

- Do not restore the v1 detail-page status card.
- Do not add a database column, table, migration, or new execution-state enum.
- Do not add or change failure, completion, operating-system, or in-app Toast notifications.
- Do not remove or change the existing manual “task triggered” Toast.
- Do not add percentage progress; Agent tasks do not currently report meaningful progress.
- Do not change generic JobManager lifecycle behavior or expose JobManager mutation details to the renderer.

## Domain Model

Schedule state and execution state remain different concepts:

| Concept | Values | Authority |
| --- | --- | --- |
| Schedule state | `active`, `paused`, `completed` | `JobSchedule` projected as `ScheduledTaskEntity.status` |
| Job state | `pending`, `delayed`, `running`, `completed`, `failed`, `cancelled` | `jobTable` / `JobSnapshot.status` |
| Task run display state | `running`, `completed`, `failed`, `cancelled` | Existing `TaskRunLogEntity.status` projection |

The scheduled-task read model gains a nullable `runSummary` object. This is a new transport projection, not a persisted lifecycle type. Its status reuses the existing four-value task-run display state:

```ts
type TaskRunSummary = {
  id: string
  status: TaskRunLogEntity['status']
  startedAt: string
  finishedAt: string | null
}
```

`ScheduledTaskEntity.runSummary` is `TaskRunSummary | null`.

## Projection Rules

For each task schedule:

1. If one or more Jobs are `pending`, `delayed`, or `running`, choose the newest active Job and project it as `running`.
2. Otherwise choose the newest terminal Job and preserve `completed`, `failed`, or `cancelled`.
3. If no Job exists, return `null` and omit the execution-summary row.

An active Job wins over a newer terminal Job so overlapping executions never make a task look idle while work is still outstanding. Selection is performed in the main-process task read model with bounded batch queries for the current task page; the renderer must not issue one Job request per card.

## Data Flow and Synchronization

`jobTable` remains the single source of truth. `AgentTaskService` composes schedules, Agent ownership, channel subscriptions, reusable-session information, and the new run summary into `ScheduledTaskEntity`.

The `agent.task` feature layer publishes scheduled-task read-model changes when an execution starts and when it settles. The same notification also invalidates the affected task-history projection. This follows the existing main-event-to-business-read-model pattern without adding a feature-specific branch to generic JobManager.

Manual “run now” already invalidates task reads immediately after the pending Job is persisted; that behavior remains unchanged. Automatically scheduled Jobs become visible as `running` when their handler starts. The design deliberately does not introduce a separate queued indicator.

## Overview UI

Each overview card keeps its existing structure and right-side schedule badge. A third, independently clickable line appears below the Agent and schedule description when `runSummary` is non-null:

- Active: spinner plus `Running`
- Completed: success icon plus `Last run succeeded · <time>`
- Failed: error icon plus `Last run failed · <time>`
- Cancelled: neutral icon plus `Last run cancelled · <time>`

The compact card does not show the raw error summary. Complete errors and results remain in run history. The status line uses existing `@cherrystudio/ui` primitives and semantic design tokens. Card content outside this line continues to open the task’s default detail view.

## History Navigation

The status line links to the existing task detail route with search state:

```text
/settings/scheduled-tasks/<taskId>?tab=history&runId=<jobId>
```

The detail page treats `tab` as controlled route state. `tab=history` opens run history, and `runId` identifies the row to reveal and emphasize. When several Jobs overlap, the overview summary links to the newest active Job selected by the projection rule. A history row with a Session continues to offer the existing secondary jump into that Agent Session.

## Alternatives Considered

### Restore the v1 header card

Rejected. It restores schedule metadata density but only knows `active`, `paused`, and `completed`; it cannot represent current or latest Job execution state. It also conflicts with the newly simplified detail layout.

### Derive everything in the renderer

Rejected. The task list does not know the Job id created by an automatic schedule fire. Fetching history independently for every card creates N+1 reads and still requires a synchronization strategy.

### Add execution fields to JobSchedule persistence

Rejected. This duplicates `jobTable`, creates two sources of truth, and requires cross-cutting JobManager writes and a migration. The status is already derivable from existing Job rows.

### Add a generic JobManager schedule-projection event

Rejected for this scope. A generic cross-consumer event would be an infrastructure extension justified by one feature. The owning `agent.task` handler already has start and settlement boundaries where its business read model can be refreshed.

## Error Handling and Edge Cases

- A task with no runs has no execution-summary line.
- A failed Job may have no Session; navigation always targets run history first.
- Sticky Session reuse does not affect run identity because the summary and route use Job id.
- Deleted tasks retain historical Jobs with a null schedule id, but no deleted task card exists to display them.
- If the target Job is no longer present in the loaded history, the history tab still opens normally without a highlighted row.
- Schedule auto-pause after three consecutive failures remains existing behavior; the schedule badge updates independently of the failed run summary.

## Verification Strategy

The implementation follows test-driven development. Each test must fail for the missing behavior before production code is written.

1. Data-service tests using the real test database protect the projection rules: active-over-terminal precedence, newest-active selection, newest-terminal selection, state collapsing, and the no-run case.
2. Agent-task handler tests protect read-model invalidation at execution start and settlement without testing generic JobManager internals.
3. Renderer component tests protect user-visible card labels and the distinct history link.
4. Route/component tests protect `tab=history`, target-row reveal, and preservation of the default detail route for the rest of the card.
5. Targeted tests run during each red/green cycle. Before completion, run `pnpm lint`, `pnpm test`, `pnpm format`, `pnpm build:check`, and `pnpm test:lint`, then verify the overview and history navigation in the tracked Electron instance.

## Success Criteria

- A user viewing scheduled tasks can tell whether each previously run task is active, succeeded, failed, or was cancelled.
- The displayed state updates after automatic execution starts and settles without reopening the page.
- Schedule state remains visible and is never replaced by execution state.
- Clicking the execution summary opens and locates the corresponding run-history entry.
- No new notification appears and the existing manual-trigger Toast remains unchanged.
