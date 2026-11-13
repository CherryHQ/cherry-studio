# Agent Note: Scheduled task session picker

Status: proposed

English | [中文](2026-11-14-scheduled-task-session-picker.zh.md)

## Problem

A scheduled task can only reuse a session that its first fire happened to create. The form exposes a single `reuseSession` switch (`src/renderer/components/ScheduledTask/TaskFormDialog.tsx:401-416`), and the entity's `reuseSessionId` is documented as "the sticky session bound by the last fire; null until the first fire" (`src/shared/data/api/schemas/agents.ts:184-186`). The binding is written by `AgentJobsService` after a run (`src/main/ai/agents/AgentJobsService.ts:272`, `:313-314`), so the user cannot choose which conversation a task continues.

The only documented way to rebind is to disable, save, enable, and save (`src/renderer/i18n/locales/en-us.json:506`). That is undiscoverable and still forces a fresh session rather than an existing one. The agent-facing `reuse_session` tool parameter is also a boolean only (`src/main/ai/mcp/servers/cherryAutonomyTools.ts:137`). Users who keep one long-running thread per project, or who want to automate an existing conversation in place, have no way to do it (#21190).

## Proposal

Replace the boolean in the task form with a three-way session choice:

- **New session per fire** — today's `reuseSession: false`.
- **Continue the bound session** — today's `reuseSession: true`; the session is bound by the first fire.
- **Continue an existing session** — the user picks one session of the selected agent. The picked id is saved as `reuseSessionId` immediately, so the first fire continues it and does not create another.

### Data

- No new columns on this Spec's own. `reuseSession` and `reuseSessionId` keep their meanings. Saving an existing-session choice sets `reuseSession: true` and `reuseSessionId` to the picked session id.
- The proposed ownership model in `2026-10-31-scheduled-tasks-page.md` (`agent_session.taskId`, `isTaskReuseTarget`, unshipped migration `0035`) is the storage basis for picked sessions. If that Spec changes before implementation, this Spec is revised with it.
- Existing tasks keep their current state on upgrade. No migration or backfill from this Spec.

### Selection rules

- The picker lists only sessions owned by the selected agent. `AgentJobsService` rejects a picked session that belongs to another agent on create and on update.
- While an existing session is selected, the workspace field is disabled and shows that the task runs in that session's workspace. Changing the workspace would otherwise silently drop the bound pointer (`AgentJobsService.ts:313-314`).
- Selecting an existing session shows the context-growth warning (`agent.tasks.reuseSession.warning`) at selection time, not only as static copy.

### Editing

- Editing prompt, schedule, timeout, or channels never changes `reuseSessionId`.
- Only an explicit change of the session choice in the form changes the bound session. Switching to "New session per fire" clears it.

### Missing session

- If the bound session was deleted before a fire, the fire fails with a dedicated error code and does not create a new session. The run log records the failure.
- The task detail shows a missing-session state. The user resolves it by picking another session or switching mode. There is no silent fallback.
- `resolveTaskConversation` (`src/renderer/services/taskConversation.ts:59-61`) currently falls back when the bound session is missing. For reuse-enabled tasks this partially supersedes step 3 of the resolver order in `2026-10-31-scheduled-tasks-page.md`: the missing-session state is shown instead of the latest run. That Spec stays active; its other resolver steps are unchanged.

### Scope

- Agent-facing `reuse_session` keeps its boolean behavior. It does not gain a session picker in this change.
- Remote task API output (`src/main/services/remoteAccess/agentTaskQueries.ts:120`) reads the same fields and needs no change.

## Alternatives considered

- **Rebind action on the task detail row.** Smaller, but it does not let users choose a session at creation time and keeps the three-step mental model. Rejected for this Spec; it can be added later on top of the picker.
- **Entry point from a conversation ("run this task here").** Best discovery for in-place automation, but it spans the conversation UI and task creation. Deferred; it reuses the same service rules defined here.
- **Fall back to a new session when the bound session is missing.** Reproduces today's confusion in a new place (#21190). Rejected.
- **Let the workspace follow the picked session and keep the pointer.** Possible, but it changes which workspace the form displays and would need its own migration story. Rejected for now; the workspace is disabled instead.

## Acceptance criteria

- AC1 — The task form offers "new session per fire", "continue the bound session", and "continue an existing session"; the saved choice reloads unchanged after reopening. (verification: renderer test; Electron)
- AC2 — Saving an existing-session choice binds that session before the first fire, and the first fire continues it without creating a new session. (verification: main-process service test)
- AC3 — The picker lists only sessions of the selected agent, and the service rejects a session belonging to another agent on create and update. (verification: main-process service test; renderer test)
- AC4 — Selecting an existing session shows the context-growth warning at selection time. (verification: renderer test)
- AC5 — Editing prompt, schedule, timeout, or channels never changes `reuseSessionId`; only an explicit change of the session choice does. (verification: main-process service test)
- AC6 — When the bound session was deleted, the fire fails with a dedicated error, creates no session, and the task shows a missing-session state until the user picks a session or changes mode. (verification: main-process service test; renderer test)
- AC7 — Tasks that exist before the change keep their current `reuseSession` and `reuseSessionId` values and behavior with no migration. (verification: main-process service regression test)
- AC8 — While an existing session is selected, the workspace is disabled and the form explains why. (verification: renderer test)
- AC9 — New and changed labels are translated in all shipped locales, and the i18n check passes. (verification: docs gate; semantic review)

## Risks

- A picked session may be long and already exceed the model's context window. The warning and the fail-loud behavior limit the damage but do not prevent it.
- Deleting a picked session leaves the task in a missing-session state that must be resolved manually. This is intentional but may look like a regression to users who relied on the silent fallback.
- The picker depends on the session list of the selected agent. Agents with many sessions need pagination or search; the first implementation may cap the list and must say so.
- Session/conversation duality (CherryHQ/cherry-studio#20635) is still open. If that work changes what a session id refers to, this Spec must be revised before implementation.

## Related notes

- `proposed/feature/2026-10-31-scheduled-tasks-page.md` — owns task ownership and resolver order; partially superseded for the missing-session fallback (see Missing session).
- `implemented/bug-fix/2026-11-07-scheduled-task-resume-refresh.md` — resume refresh behavior; this Spec does not change it.
