# Agent Task Cleanup Across Trash and Purge

## Status

Approved on 2026-09-03.

## Context

Agent task schedules are persistent `agent.task` job schedules. Channel subscriptions reference those schedules and are deleted by foreign-key cascade when a schedule is removed. Moving an Agent to the Recycle Bin currently emits the same `onAgentDeleted` event as permanent deletion, so the event name hides two different lifecycle transitions even though both transitions must permanently remove task schedules.

Restoring an Agent intentionally restores only the Agent and the sessions moved to the Recycle Bin with it. Task schedules and channel subscriptions are irreversible child data: they are removed when the Agent is trashed and are never rebuilt during restore.

The design must also recover from a process crash between committing the Agent's `deletedAt` value and handling the post-commit cleanup event, and it must prevent stale task commands from operating while that cleanup is pending.

## Goals

- Represent Agent trash and purge as separate, explicit post-commit lifecycle events.
- Permanently unregister all task schedules and channel subscriptions when an Agent is trashed.
- Keep purge and startup cleanup idempotent so interrupted event handling is repaired.
- Reject task commands for Agents that are either trashed or missing.
- Tell users before trashing an Agent that task schedules and channel subscriptions cannot be restored.
- Preserve existing historical job-record behavior and existing Agent/session restore scope.

## Non-goals

- Restoring or reconstructing task schedules or channel subscriptions.
- Changing the task schedule schema, foreign keys, or historical job retention.
- Changing the protected built-in Agent flow, which removes sessions without trashing the Agent.
- Introducing a new generic lifecycle-event framework.

## Alternatives Considered

### Separate `onAgentTrashed` and `onAgentPurged` events — selected

The canonical Agent data service publishes the lifecycle fact after the corresponding transaction commits. Consumers cannot accidentally interpret a generic deletion event without knowing whether the row is recoverable, and retention purge can publish the same permanent lifecycle fact as an explicit permanent delete.

This adds two narrowly scoped event surfaces, but their names make the contract self-documenting and independently extensible.

### One event with `reason: 'trashed' | 'purged'`

This has a smaller diff but preserves a single overloaded event. Every current and future subscriber must branch correctly on `reason`; ignoring the field silently recreates the ambiguity that caused the review issue.

### Direct cleanup calls from feature/UI deletion entry points

This avoids changing the Agent service event contract but is insufficient. Agent deletion has multiple callers, retention purge is a separate workflow, and direct data-service callers could bypass feature orchestration. It would also couple the renderer-facing deletion feature to main-process job infrastructure. The Agent service is the canonical owner of the lifecycle transition, so a post-commit event is the reliable boundary.

## Architecture

### Agent lifecycle events

`AgentService` replaces `onAgentDeleted` with:

- `onAgentTrashed({ agentId })`, fired after a successful soft-delete transaction commits.
- `onAgentPurged({ agentId })`, fired after a successful explicit permanent delete or retention purge commits.

No event is emitted for a no-op deletion. Transactional purge methods remain DB-only; the existing post-commit purge notification path publishes `onAgentPurged` for the IDs committed by retention cleanup.

`restoreAgent()` continues restoring the Agent and only the sessions selected by its existing shared-deletion-timestamp rule. Its API documentation will explicitly state that task schedules and channel subscriptions are not restored.

### Task cleanup ownership

`AgentJobsService.deleteSchedulesForAgent(agentId)` remains the single per-Agent cleanup operation. Its responsibility is described as deleting the Agent's scheduled tasks, not merely cleaning up orphans.

For every matching `agent.task` schedule it calls `JobManager.unregisterJobScheduleById()` so that the existing JobManager contract remains intact:

- the `job_schedule` row is deleted;
- the in-process scheduler timer is disposed;
- `agent_channel_task` rows are deleted through the existing foreign key;
- historical `job` rows retain their established `scheduleId = NULL` semantics.

`AgentJobsService` subscribes to both lifecycle events. Each listener invokes the same idempotent cleanup and logs failures without treating a post-commit cleanup failure as a failed Agent deletion.

### Reconciliation

`deleteOrphanedSchedules()` is renamed to `deleteSchedulesForInactiveAgents()`. An inactive Agent is one whose row is either trashed or absent. The method scans only `agent.task` schedules and unregisters every schedule whose template references an inactive Agent.

The reconciliation runs in two places:

- once from `AgentJobsService.onAllReady()` as startup business reconciliation;
- after the database transactions in the trash purge job, including when retention-based row deletion is disabled.

Both paths are best-effort and idempotent. They repair a crash after the Agent state committed but before its lifecycle listener completed. They do not recreate schedules.

### Inactive-Agent command guard

Every Agent task command first verifies that the owning Agent is active, then verifies the task type and ownership through the existing `AgentTaskService.getTask()` lookup. This applies to update, pause, resume, run-now, delete, and sticky-session binding; create keeps its existing active-Agent assertion.

For by-ID commands, an inactive Agent has the same external result as a missing or unowned task (`null` or `false`, matching each command's current contract). This preserves the no-existence-leak behavior and avoids adding an IPC error code that no renderer flow consumes.

The guard closes the important post-commit window: after the Agent is trashed but before asynchronous schedule cleanup finishes, a stale request cannot modify, resume, run, or bind the old schedule.

## User Experience

All confirmation surfaces that actually move an Agent to the Recycle Bin display this warning:

> Scheduled tasks and channel subscriptions associated with this Agent will be permanently deleted and will not be restored if you restore the Agent.

The Simplified Chinese translation states:

> 与此 Agent 关联的定时任务和频道订阅将被永久删除，恢复 Agent 后不会恢复。

The warning is added to the resource catalog dialog, Agent sessions page, and Agent resource list confirmation paths. It is not shown for protected built-in Agents because that operation deletes sessions only and does not trash the Agent or its tasks.

The existing breaking-change note is updated to identify task schedules and channel subscriptions as non-restorable child data.

## Error Handling

- Agent trash and purge transactions remain authoritative and are not rolled back by a later cleanup failure.
- Lifecycle listeners log cleanup failures with the Agent ID; startup and purge reconciliation retry the invariant later.
- Repeated cleanup, overlapping lifecycle cleanup, and reconciliation are safe because unregistering an already-removed schedule returns `false`.
- Renderer commands keep their existing not-found-style results for inactive Agents.

## Verification

Tests will prove contracts rather than implementation calls:

- soft delete emits only `onAgentTrashed`; explicit and retention permanent deletion emit only `onAgentPurged`;
- trashing an Agent removes its schedule, disposes its timer, cascades channel subscriptions, and restoring the Agent does not recreate them;
- startup/purge reconciliation removes schedules for both trashed and missing Agents while retaining schedules for active Agents;
- update, pause, resume, run-now, delete, and session binding cannot operate for an inactive Agent during the pre-cleanup window;
- all three real Agent-trash confirmations show the warning, while protected built-in Agent session-only confirmation does not;
- relevant main-process and renderer tests pass, followed by repository lint, CI-equivalent warning checks, i18n checks, and documentation checks.

## Acceptance Criteria

1. Trashing an Agent permanently deletes every associated task schedule and channel subscription.
2. Restoring that Agent restores no task schedule or channel subscription.
3. Purging an Agent is safe even if trash-time cleanup already ran.
4. Startup and purge reconciliation remove schedules owned by trashed or missing Agents.
5. No task command can mutate or execute a task for an inactive Agent.
6. Users see the irreversible-data warning only when the Agent itself will enter the Recycle Bin.
