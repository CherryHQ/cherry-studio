# Agent Note: Broadcast task read-model changes after every committed task write

Status: implemented

English | [中文](2026-10-28-agent-task-update-notify.zh.md)

## Problem

`AgentJobsService.updateTask` published a DataApi read-model notification only when the reuse config, a cleared sticky-session binding, or the workspace changed. A pure rename, prompt, trigger, timeout, or channel-subscription edit changed the persisted row and its projection (`name`, `prompt`, `trigger`, `nextRun` are all part of `ScheduledTaskEntity`) without any broadcast, violating the publish invariant that a missed signal is a convergence bug. Renderer-initiated edits hid the gap because `useUpdateTask` explicitly invalidates the read keys after its command, but the IM/MCP manage-jobs tool calls `updateTask` in the main process with no such compensation, so any window showing the task overview kept stale values until an unrelated change or remount. `pauseTask` and `resumeTask` never broadcast at all while `enabled`/`status`/`nextRun` are projected.

## Decision

`updateTask` notifies unconditionally after the write transaction commits — `updateTx` always bumps `updatedAt`, so a provable no-op never exists and a redundant notification only costs one refetch. `pauseTask` notifies after a real state change; its existing guard already keeps repeated pauses silent. `resumeTask` notifies after a real resume, and because `resumeJobScheduleById` commits `enabled=true` before arming the timer, an arm failure is classified by re-reading the row: a committed enable still broadcasts, a failed write stays silent, and the original error always propagates unmasked — the classification read is best-effort, and its failure only logs. Timer re-registration semantics, startup recovery, and the JobManager contract are unchanged.

## Alternatives considered

- Keeping the conditional gate and computing a field-level diff (name/prompt/trigger/channelIds changed) — more precise on paper but easy to re-introduce the same drift when new editable fields land, and the publish contract already prices a redundant refetch below a missed signal.
- A plain `finally` around the resume call — also broadcasts when the write itself failed and nothing was committed.
- Returning the commit result from `JobManager.resumeJobScheduleById` so the caller needs no re-read — a `core/job` contract change requiring its own issue and PR; the in-service classification achieves the invariant without touching infrastructure.

## Consequences

Every committed task write costs one read-model notification; failed writes stay silent. If the enable committed and the classification read also fails (database unavailable), that notification is missed and logged — the same degraded convergence as before for that double-fault case, healed by the next change or remount. After an arm failure the row is enabled but the timer is not installed until startup recovery or the next sync — pre-existing JobManager semantics, unchanged.

## Verification

- Regression — `src/main/ai/agents/__tests__/AgentJobsService.test.ts`: a pure rename and real pause/resume broadcast the full effect set; state-aware no-ops stay silent; an arm failure after a committed enable broadcasts before propagating the original error while a failed write stays silent; a failed classification read preserves the original error object without notifying.
