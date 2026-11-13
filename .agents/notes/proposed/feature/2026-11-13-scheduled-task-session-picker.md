# Agent Note: Scheduled task session picker

Status: proposed

English | [中文](2026-11-13-scheduled-task-session-picker.zh.md)

## Problem

A scheduled task with `reuseSession` on continues whatever session its first fire happened to create. The user cannot choose an existing conversation as the task's target. Moving a task to another conversation requires a disable-save-then-enable-save workaround that is undiscoverable and still cannot select a target (issue #21190).

The current code is:

- `TaskFormDialog.tsx` renders `TaskSessionReuseField` as a boolean switch with no session choice (`src/renderer/components/ScheduledTask/TaskFormDialog.tsx:402-413`, `:665`).
- The sticky session is found by its task link, not by a stored pointer: `loadReusableSession` calls `agentSessionService.getByTaskScheduleId` (`src/main/ai/agents/runAgentTask.ts:84-92`). `reuseSessionId` is derived from that link (`src/main/data/services/AgentTaskService.ts:611-612`).
- A deleted or re-owned session is silently replaced by a fresh one ("rebind a fresh one") (`src/main/ai/agents/runAgentTask.ts:88-92`).

## Proposal

### Scope

- When `reuseSession` is on, the task form shows a session picker listing the selected Agent's existing sessions. Saving with a chosen session links that session to the task, so the next fire continues it.
- Selecting a session shows the existing context-growth warning at selection time, not only as a static note.
- Turning `reuseSession` off clears the binding. This matches current behavior.
- If the bound session no longer exists at fire time, the fire fails loudly: no new session is created, the run is recorded as failed with a reason, and the task is marked degraded. The task stays enabled so the user can rebind it from the picker.
- Editing a task without changing the picker never changes the bound session.

### Out of scope

- A "run this task in this conversation" entry point from the conversation itself.
- A "Rebind to session…" action on the task row (the picker covers rebinding).
- Changes to the `reuseSession` boolean's storage, the scheduler, or session lifetime rules.
- Changes to how a fired message is framed (#15574) or to the session and conversation model (#20635).

### Binding rules

- One session can be bound to at most one task. Choosing a session already bound to another task is rejected with an error that names the other task.
- The picker lists only sessions of the task's Agent.
- The bound session keeps its own workspace; the task's workspace source applies only when a new session is created.

## Alternatives considered

- **Keep the boolean and add a "rebind" action on the task detail row.** Smaller, but the user still cannot choose a target from the form and rebinding is not discoverable. Rejected for this Spec; the picker covers the same case.
- **Entry point from the conversation.** Most natural for "onboard an existing conversation", but it adds a second write path to the same binding. Deferred until the picker has landed.
- **Silent fresh session on a deleted binding (current behavior).** Reproduces the confusion in a new place: the user's chosen conversation is replaced without notice. Rejected.
- **Store a `reuseSessionId` pointer on the task as the source of truth.** Would duplicate the existing session-to-task link and create two sources of truth. Rejected.

## Acceptance criteria

- AC1 — With reuse on, the form lists the selected Agent's sessions; saving a chosen session makes the next fire continue it (verification: renderer, unit)
- AC2 — Selecting a session already bound to another task is rejected with an error naming that task (verification: unit)
- AC3 — When the bound session is deleted, the fire fails: no session is created, the run is recorded as failed with a reason, and the task is marked degraded (verification: unit)
- AC4 — Editing a task without changing the picker leaves the bound session unchanged (verification: unit)
- AC5 — Choosing a session shows the context-growth warning at selection time (verification: renderer)
- AC6 — Turning reuse off clears the binding and the next fire creates a fresh session (verification: unit)

## Risks

- Changing deleted-binding behavior from "rebind fresh" to "fail" alters an existing, tested path (`runAgentTask.test.ts` "rebinds when the constrained relation no longer has a session"). Existing tests must be updated deliberately, not left green by accident.
- A picker over a long-lived session invites the context-overflow case the warning describes; AC5 is the mitigation, not a limit on context size.
- "Degraded" needs a concrete UI signal. The implementation layer must define it before AC3 is verified.
