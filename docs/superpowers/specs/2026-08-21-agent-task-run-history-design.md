# Agent Task Run History Design

**Date:** 2026-08-21

## Problem

The scheduled-task overview represents `JobSchedule` definitions. It shows each task's schedule state and a compact current-or-latest run summary, while complete run history is available only inside one task's detail page. Users cannot browse retained executions across all Agent scheduled tasks from one place.

The new view must preserve the existing distinction between a schedule definition and the Jobs produced by that schedule. It must not turn JobManager's generic runtime state into editable renderer state or introduce a second execution-history store.

## Goals

- Add one settings view for retained executions produced by Agent scheduled tasks.
- Keep the schedule list and the execution list as separate, clearly named surfaces.
- Reuse `jobTable` as the execution source of truth and the existing Agent task read model as the projection owner.
- Show task and Agent identity, execution time, duration, status, result or error, and the existing Agent Session link when available.
- Keep Jobs from deleted schedules visible with an explicit deleted-task fallback.
- Keep queued Jobs distinct from running Jobs.
- Refresh the list while it is open so new Jobs and status transitions become visible.

## Non-goals

- Do not add a table, column, SQLite view, migration, or separate history store.
- Do not change JobManager retention. Terminal Jobs remain subject to the current seven-day TTL and latest-100-per-type cap.
- Do not expose knowledge-indexing or other non-Agent Job types.
- Do not show whether a run came from the natural schedule or the user-invoked Run Now command. The current Job row does not persist that distinction.
- Do not preserve the original name of a deleted schedule. Its Job remains visible with `taskName: null`.
- Do not add Job mutations, cancellation controls, retry controls, a Job detail page, or a raw Job payload inspector.
- Do not change the existing per-task History tab.

## Existing Patterns

The design follows three existing repository patterns:

- Scheduled-task detail uses a static settings list plus a child route that replaces the right content pane and provides a ghost Back button.
- MCP server detail uses the same settings-pane replacement and Back-button interaction.
- Agent and Assistant history use a full content surface for a searchable history browser. Dialogs remain appropriate for bounded workflows such as backup management, but an all-task execution browser is a navigable settings surface rather than a short-lived command flow.

## Navigation and Page Surface

The scheduled-task list toolbar gains a ghost icon button using the History icon. The button has an i18n-backed accessible name and Tooltip for `Execution records`; it sits between the list filters and the primary New Task action so it remains a secondary action.

The button navigates to the static child route:

```text
/settings/scheduled-tasks/runs
```

The route replaces only the right settings content pane. The settings sidebar stays mounted and continues to mark Scheduled Tasks as active. The run page starts with the same round ghost Back button used by task detail and returns to `/settings/scheduled-tasks`. Normal route navigation also leaves a history entry for operating-system or browser Back navigation.

The route owns a separate `AgentTaskRunsSettings` page component. It does not add another conditional branch to the already large `TasksSettings` component.

## Read Model

The Agent DataApi schema gains an additive renderer-facing projection. The exact schema follows this contract:

```ts
type AgentTaskRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

type AgentTaskRunEntity = {
  id: string
  taskId: string | null
  taskName: string | null
  agentId: string | null
  runAt: string
  durationMs: number | null
  status: AgentTaskRunStatus
  sessionId: string | null
  result: string | null
  error: string | null
}
```

`taskId` and `taskName` are nullable because deleting a schedule sets historical Jobs' `scheduleId` to `NULL`. `agentId` is read from the persisted Agent task input and is nullable defensively so one malformed historical input does not hide the rest of the list.

After that foreign key is cleared, persisted data cannot prove whether an `agent.task` Job originally came from a schedule. The projection therefore treats every retained `agent.task` Job as in scope. This matches current production enqueue paths; if a future feature adds ad-hoc `agent.task` enqueues, those rows will use the deleted-task fallback until trigger origin becomes an explicit persisted contract.

The collection route is read-only:

```text
GET /agent-task-runs
```

The response is `AgentTaskRunEntity[]` and contains all currently retained projected items in newest-first order. The renderer performs search and Agent/status filtering over that bounded set. This avoids pagination drift while the newest-first list is being written and stays bounded by JobManager's existing per-type terminal retention; non-terminal Jobs are included in addition to retained terminal Jobs.

This is a code-level DataApi projection, not a SQLite `VIEW`. It adds a shared response schema and endpoint contract but does not change persisted data.

## Projection Rules

`AgentTaskService` owns the projection because it already composes Agent task schedules with their Job run logs. It reads Jobs through `JobService` with `type = 'agent.task'`, resolves current schedules through `JobScheduleService`, and maps persisted Job input and output without writing either table.

For every retained Agent task Job:

1. Sort by Job creation time descending, with Job id as the deterministic tie-breaker.
2. Map `pending` and `delayed` to `queued`.
3. Preserve `running`, `completed`, `failed`, and `cancelled`.
4. Use `startedAt` when present and otherwise `scheduledAt` as `runAt`.
5. Compute `durationMs` only when both start and finish timestamps are valid; otherwise return `null`.
6. Read `sessionId` and the result summary from the existing Agent task output. Use the persisted Job error message for failed or cancelled rows.
7. Resolve `taskName` from the current `agent.task` schedule. When the schedule no longer exists, return `taskId: null` and `taskName: null` so the renderer can localize `Deleted task`.
8. Read `agentId` from the Agent task input. The renderer resolves current Agent names from the existing Agent list and localizes the deleted/unavailable fallback.
9. Exclude Jobs whose current schedule is the hidden Heartbeat schedule, using the same feature-owned identity rule as the scheduled-task overview. A deleted schedule no longer exposes its former name and therefore uses the ordinary deleted-task fallback.

No heuristic attempts to label Run Now versus natural schedule fires. Both remain ordinary executions in this view.

## List UI

The page header contains the Back icon, `Execution records`, and a muted retention explanation: `Completed records are retained for up to 7 days, with at most 100 per Job type`. The controls provide:

- text search across the displayed task and Agent names;
- Agent selection;
- status selection across All, Queued, Running, Completed, Failed, and Cancelled.

The shared `DataTable` displays:

| Column | Content |
| --- | --- |
| Task | Task name with Agent name as secondary text; localized deleted fallbacks when either owner no longer exists |
| Execution time | Localized `runAt` |
| Duration | Localized duration for terminal rows, otherwise an em dash |
| Status | Accessible, localized status badge |
| Result | Result summary, error text, or queued/running explanation; an icon action opens the Agent Session when `sessionId` exists |

Rows are not themselves interactive. Only the explicit Session action navigates away, matching the existing per-task run-history behavior. The table occupies the page's lower scroll region and retains the scheduled-task page's centered content width. A horizontal scroll wrapper protects the table at narrow settings-pane widths.

Search and filters are client-side because the retained set is bounded and already loaded for display. Changing a filter immediately recomputes the visible rows. Leaving and re-entering the route resets filters in the first version.

## Refresh and Data Flow

The renderer reads `GET /agent-task-runs` through `useQuery`. While the route is mounted, SWR revalidates the local SQLite-backed projection every five seconds so automatically scheduled enqueues and later status transitions appear without a JobManager infrastructure event. The refresh stops when the page unmounts and follows SWR's normal window-visibility behavior.

This polling is intentionally page-scoped. Adding a generic JobManager list event or a feature-specific branch inside JobManager would expand shared infrastructure for one consumer. Run Now continues to invalidate the existing task reads as it does today; the run page's next revalidation observes the new row.

The data flow is:

```text
job + job_schedule tables
  -> JobService + JobScheduleService reads
  -> AgentTaskService projection
  -> GET /agent-task-runs
  -> renderer query hook
  -> AgentTaskRunsSettings filters and DataTable
```

## Loading, Empty, and Error States

- Initial loading shows a page-level Spinner.
- An initial request failure shows an error Empty State with a Retry action.
- A successful empty response shows the no-execution-records Empty State.
- A non-empty response reduced to zero by filters shows a no-matches Empty State with Clear Filters.
- A background refresh failure keeps the last successful list visible and logs through `loggerService`; it does not emit a repeating Toast.
- A missing or malformed task input does not fail the entire response. The affected row uses unavailable identity fallbacks.
- A missing Session omits the Session action. Result and error text remain visible.

## i18n and Accessibility

All visible labels, Tooltip text, accessible names, retention copy, statuses, fallbacks, and empty/error states use the existing scheduled-task i18n namespace. The History and Back icon buttons have accessible names and Tooltips. Status meaning is conveyed by text and iconography rather than color alone. The implementation uses `@cherrystudio/ui` components and semantic tokens in both light and dark themes.

## Alternatives Considered

### Dialog

Rejected for the all-records surface. A Dialog is feasible and the backup manager proves that a table can live in one, but this collection is a durable, filterable history browser. A child route provides more space, Back navigation, reload behavior, and a stable place for future read-only detail without turning a modal into a second page shell.

### Page-level tabs

Rejected in favor of the approved toolbar icon. Tabs make Schedule and Job views equally prominent, but execution history is a secondary diagnostic surface and should not compete with the schedule-management default.

### Side drawer

Rejected. It is efficient for a short recent-activity preview but constrains table width and does not fit the complete retained collection, filtering, and result summaries.

### Read raw `/jobs` in the renderer

Rejected. Raw Jobs expose infrastructure fields and free-shape input/output while lacking task-name and deleted-task presentation. The Agent-owned projection keeps renderer semantics narrow and prevents Job infrastructure details from becoming a UI contract.

### Add persisted execution history or schedule snapshots

Rejected for the first version. Existing Job rows contain the required execution data. A new store would duplicate lifecycle state, require migration and retention ownership, and create a second source of truth. Preserving deleted task names or trigger origin can be designed separately if those become explicit requirements.

## Verification Strategy

The implementation follows test-driven development. Each test must protect a user-visible or data-boundary contract rather than restating implementation details.

1. `AgentTaskService` tests use the real file-backed test database and production migrations. They cover type filtering, Heartbeat exclusion, newest-first ordering, deleted-schedule fallback, malformed-input isolation, status mapping, time and duration mapping, result/error mapping, and Session ids.
2. DataApi handler tests cover the read-only collection contract and failure propagation.
3. Renderer hook tests cover initial fetch and periodic revalidation configuration.
4. Settings-page tests cover the History icon's accessible navigation, Back navigation, visible columns, all status labels, Session action, initial loading/error/empty states, no-match clearing, and Agent/status/search filtering.
5. Route tests protect the static `/runs` route from being consumed as `$taskId`.
6. Run `pnpm lint` and the targeted main, handler, hook, and settings-page Vitest files. Because the change is scoped to an additive projection and one settings page, the global test suite is unnecessary unless targeted verification reveals broader impact.
7. Verify the final interaction in the tracked Electron instance: open execution records from Scheduled Tasks, exercise filters and horizontal/vertical scrolling, confirm queued-to-running-to-terminal refresh, open a Session, and return to the schedule list.

## Success Criteria

- A user can open one execution-records surface from the scheduled-task toolbar and return without leaving Settings.
- The list contains all retained `agent.task` Jobs, excludes unrelated Job types, and excludes identifiable Heartbeat schedules.
- Queued and running executions are visibly distinct.
- Deleted schedules do not make their retained Jobs disappear; they render as `Deleted task`.
- Results, failures, durations, and Session navigation match the existing per-task history semantics.
- The view updates while open without a new JobManager infrastructure contract.
- No database schema, migration, retention, trigger-origin, or Job mutation behavior changes.
