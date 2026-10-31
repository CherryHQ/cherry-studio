# Agent Note: Scheduled tasks page

Status: proposed

English | [中文](2026-10-31-scheduled-tasks-page.zh.md)

## Problem

Scheduled tasks are available through settings, but there is no dedicated global-sidebar page for selecting a task and continuing its associated conversation.
The requested workflow should feel like Chat and Agents: a task list on the left and the existing conversation on the right.
The right pane must remain a conversation, including its composer, rather than become a task-details or execution-log screen.

The current implementation already provides a shared creation form, task commands, derived task states, and execution-to-session references.
The missing work is their page integration, correct group pagination, and safe selection of an associated conversation.
This Spec describes proposed behavior. The page is not implemented, and the product acceptance criteria remain unverified.

## Proposal

### Scope and labels

- Add a Scheduled tasks entry to the global sidebar and a dedicated page using the Chat and Agents layout.
- Put Add scheduled task at the top of the page sidebar; open a centered Create scheduled task modal in the current window.
- Keep two groups below the button: Active and Paused. Selecting a task displays its associated conversation on the same page.
- Reuse the shared form and the creation integration pattern from [PR #21849](https://github.com/CherryHQ/cherry-studio/pull/21849).
- Preserve the conversation composer, runtime events, tool output, approvals, and busy-state protections.

The required Chinese labels are `定时任务`, `添加定时任务`, `建立定时任务`, `活跃`, and `已暂停`.
All user-visible text uses i18next. New controls use `@cherrystudio/ui` and follow [DESIGN.md](../../../../DESIGN.md).
This scope adds no task-details page, standalone log panel, bulk operations, database table, dependency, or scheduler.
Task execution, retries, recovery, and concurrency rules remain owned by the existing runtime.

### Layout

```text
+-----------------+--------------------------+------------------------------------+
| Global sidebar  | Page sidebar             | Conversation                       |
|                 |                          |                                    |
| Chat            | + Add scheduled task     | Task title / associated session    |
| Agents          |                          | Current or historical run selector |
| Scheduled tasks | Active (total)           |                                    |
| ...             |   Task A [selected]      | Existing Agent message list        |
|                 |   Task B                 | Tool output, approvals, run state  |
|                 |   Group pagination       |                                    |
|                 |                          |                                    |
|                 | Paused (total)           |                                    |
|                 |   Task C                 |                                    |
|                 |   Group pagination       | Existing conversation composer     |
+-----------------+--------------------------+------------------------------------+
```

The three columns include the existing global sidebar. The page itself has a task sidebar and a conversation area.
Reuse `ChatAppShell`, `PageSidebar`, and the existing conversation layout for widths, resizing, collapse, and small-window behavior.
A task row shows its name, owning Agent, and a short schedule summary, with the existing list selection treatment.
Execution state is secondary information; it does not determine the Active or Paused group.

### Entry and selection

1. Open the proposed `/app/scheduled-tasks` route from the global entry and keep that entry highlighted.
2. Load Active and Paused independently. With no valid selected task, show a request to select one in the right pane.
3. Represent the selected task with `taskId`; read that task before resolving its conversation.
4. Represent an explicit historical execution with `runId`; verify its association with the task before opening its session.
5. Change only the right pane when selecting a task, preserving the task route, sidebar, and group page positions.

Do not call `openConversation` or another helper that sends task selection back to `/app/agents`.
An arbitrary URL `sessionId` is not proof that a conversation belongs to a task.
Clear the previous task's displayed data during a switch. A late response must neither overwrite the new selection nor flash old messages.

### Creation

1. Load the shared `TaskFormDialog` on demand when Add scheduled task is clicked, and open it centered in the current window.
2. Use the required Create scheduled task title and preserve the shared fields, validation, schedule conversion, and session-reuse behavior.
3. Submit through `useCreateTask`; prevent duplicate submission and reuse its existing error feedback.
4. On failure, retain the form and entered values. On success, close it, refresh both groups, and select the returned task.
5. Do not issue an extra run-now command after creation. The task follows the existing schedule rules.

A new task that has not run shows “Waiting for first execution” (`等待首次执行`) in the right pane.
The shared Chinese title currently says `新建定时任务`; change its i18n value to the required `建立定时任务` rather than copy the form.
The separate entry button uses `添加定时任务`.
Focus enters the form and remains within the modal. Outside submission, Esc or Cancel closes it and returns focus to the trigger.
During submission, preserve the shared form's `saving` guard and prevent dismissal.
If no Agent is available, explain the requirement and offer the existing Agents entry; do not create an ownerless task.

### Pause, resume, and group changes

Expose pause or resume on each task row through `useSetTaskEnabled`, without a separate write path for `enabled`.
Pausing affects future scheduling and does not terminate an execution that has already started, as in `JobManager.pauseJobScheduleById`.
Block repeated commands while pending. On success, refresh both groups and totals; on failure, retain the previous state and show the error.
Keep the selected task and its conversation when it moves between groups; do not recreate its composer because its category changed.
If removal from a group leaves its current page out of range, return to that group's last valid page.

### State and pagination contract

| Derived state | Destination | Meaning and constraint |
| --- | --- | --- |
| `active` | Active | Uses the existing derived state; it does not mean currently executing |
| `paused` | Paused | Uses the existing derived state; it does not include every disabled task |
| `completed` | Neither group for now | A one-shot schedule has fired; the existing settings entry remains available |
| `missed` | Neither group for now | Preserves the existing missed-execution meaning; the settings entry remains available |

`deriveStatus` in `AgentTaskService.ts` gives `missed` precedence, then a fired one-shot `completed`, then `paused / active`.
Do not classify by `enabled` alone or interpret the schedule's `completed` state as successful execution output.
Continue excluding heartbeat tasks and archived Agents under the existing list rules.

Each group has independent pagination with at most 50 tasks per page, in descending `createdAt` order.
Its total covers every task in that state, not only the current page. Loading, errors, and page positions are independent.
Add an optional `status` enum query to `/agent-tasks`, preserving current behavior when the parameter is absent.
Filter in the main process using the existing derivation before calculating `total` and taking the page slice.
Do not filter only the current 50 records, transfer every task to the renderer, or join per-Agent queries.

Proposed default: leave `completed / missed` in the existing settings entry instead of adding a third group.
This destination is subject to Spec review; it is not an additional confirmed product requirement.
When the selected task reaches an end state, update the list without forcibly closing its already-open conversation.

### Resolving an associated conversation

Ordinary scheduled tasks currently create `conversation` sessions; heartbeat uses `background` sessions.
Each execution normally creates a new session, while `reuseSession` uses a bound session.
The task exposes `reuseSessionId`, run records expose `TaskRunLogEntity.sessionId`, and execution writes `job.metadata.sessionId`.

Resolve the right pane in this order:

1. An explicitly selected historical run takes priority: verify that it belongs to the selected task, then read its session.
2. Without an explicit historical selection, prefer a valid `reuseSessionId` when session reuse is enabled.
3. Otherwise, find the most recent execution with a valid `sessionId`.
4. If no conversation is available, show the appropriate empty state. Viewing the page never creates a session or starts a task.

Never use `agentId` alone to open the Agent's most recent session; it may belong to unrelated work.
Use the existing session reads and type checks. Do not bypass deleted, inaccessible, or `background` session boundaries.
If an explicitly selected historical session is unavailable, show that selection's error rather than silently substitute another run.

`useTaskLogs` currently exposes only the first 50 records, although its DataApi endpoint supports pagination.
Extend the selected task's log hook to expose that pagination, with at most 50 records per page.
Proposed default: automatically search at most two pages, or 100 records, then offer to continue searching older conversations.
Each explicit continuation loads at most 50 more records. The historical-run selector also loads pages on demand.
Only reaching the end of the records establishes that there is no associated conversation; reaching the automatic budget does not.

When the latest execution is queued without a `sessionId`, display its actual state.
If an older conversation is displayed below it, label that run's time instead of presenting it as output from the latest execution.
A new execution must not replace the conversation the user is reading or composing in; offer an explicit switch to the new conversation.
Keep the run selector in the conversation header. It selects related conversations and is not a task-details or log panel.

### Continuing the conversation

Reuse `AgentChat` for message streams, tool output, approvals, and busy-state protection.
Sending a message is ordinary conversation activity: it does not edit the task prompt or schedule, or count as a run-now command.
Switching or unmounting the page removes view subscriptions only; it does not stop main-process scheduling or an executing task.
The same session in Agents, Scheduled tasks, and another window must retain the existing stream ownership and deduplication rules.

### Empty states, errors, and accessibility

| Condition | Feedback |
| --- | --- |
| Both groups are empty | Keep the add button and explain that a created task can later have a conversation |
| One group is empty | Keep its heading and zero total, with a group-specific empty state |
| Task has never executed | Show “Waiting for first execution”; do not mount an old conversation's composer |
| Searching older records | Distinguish loading, more records available, and exhausted history |
| Latest run is queued or failed without a session | Show the real execution state without fabricated messages |
| Task, Agent, or session is unavailable | Explain the unavailable resource and keep other tasks selectable |
| One group fails to load | Offer retry within that group; leave the other group and usable conversation working |
| Conversation resolution fails | Offer retry in the right pane without falling back to another task or the Agent's latest session |

Task selection, pause, resume, paging, and historical selection must work with the keyboard.
Accessible names match visible actions; loading and empty states do not rely on color. Verify light, dark, and small-window layouts.

### Ownership and implementation boundaries

| Existing owner or proposed location | Change |
| --- | --- |
| `src/renderer/utils/sidebar.ts`, `src/renderer/components/app/sidebarIcons.tsx` | Register proposed app ID `scheduled_tasks`, its title, icon, and route prefix |
| `src/renderer/utils/routeTitle.ts`, `src/renderer/utils/tabIcons.ts` | Register the route's tab title and icon |
| `src/shared/data/preference/preferenceTypes.ts`, `scripts/data-classify/data/target-key-definitions.json` | Extend app IDs and `ui.sidebar_shortcut` defaults through the existing generation pipeline |
| `src/main/data/db/seeding/seeders/sidebarShortcutMigrationSeeder.ts` | Use the existing upgrade mechanism as a reference for a one-time, idempotent entry addition |
| `src/renderer/routes/app/agents.tsx`, proposed `src/renderer/routes/app/scheduled-tasks.tsx` | Compose the same Agent conversation page with separate selection and navigation adapters |
| `src/renderer/pages/agents/AgentPage.tsx`, proposed `src/renderer/pages/agents/components/ScheduledTaskSidebar.tsx` | Isolate hard-coded route access and add task-navigation mode or a sidebar slot |
| `src/renderer/hooks/agent/useTasks.ts` | Add state-filtered pagination and log paging while retaining commands and invalidation |
| `src/shared/data/api/schemas/agents.ts`, `src/main/data/api/handlers/agents.ts`, `src/main/data/services/AgentTaskService.ts` | Define, validate, and forward the optional state filter before pagination |

`AgentPage` currently reads the `/app/agents` route API directly; replacing only its sidebar is insufficient.
Let both routes reuse its conversation composition layer while keeping `AgentChat` and runtime components within agents.
Do not import `pages/agents/AgentChat` from a sibling `pages/scheduledTasks`, or move the entire conversation module for this feature.
`useConversationNavigationOwner` currently finds ordinary Agent tabs through `findConversationTab`; its existing redirect behavior cannot drive task-local selection.
Any ownership extension must recognize a validated task-session association, never an arbitrary URL `sessionId`, and cover both views and multiple windows.

For new installations, place the default entry near Chat and Agents through the `core.app` shortcut provider.
For upgrades, add it once to `ui.sidebar_shortcut`, preserving pinned entries and their relative order.
Use the existing Preference and seeding version journal; never replace the whole configuration or reinsert a user-removed entry on every launch.
`ui.sidebar.favorites` is a legacy migration source, not the current shortcut preference. Do not treat changing that old default as sufficient.
`preferenceSchemas.ts` is generated; update its source definitions and run the existing generator.

### Shared form and compatible entry points

The current main branch already has `components/ScheduledTask/TaskFormDialog.tsx`, `scheduleForm.ts`, and `TaskRunSummaryLine.tsx` under `src/renderer/`.
`TasksSettings.tsx` already imports the shared form. Reuse it directly; do not extract another copy or replace its schedule validation.
In creation mode, the form accepts `open`, `agents`, `onOpenChange`, and a boolean-returning async `onCreate`; adapt `useCreateTask` to that contract.
Use [PR #21849](https://github.com/CherryHQ/cherry-studio/pull/21849) as the reference for opening the form in place, not as a dependency on its entire PR stack.
The current main branch has no `AgentTaskDashboard`. Preserve the existing settings and Agents entries; if that dashboard lands, keep it compatible too.
Existing external links remain valid. This page does not remove other task entry points.

### Data flow and performance budget

Reads stay on DataApi: `/agent-tasks`, `/agent-tasks/:taskId`, and `/agents/:agentId/tasks/:taskId/logs`.
Create, pause, and resume stay on IpcApi `ai.agent.task.create / pause / resume`.
Reuse successful-command invalidation and task data-change events to refresh both groups, totals, and the selected task.

- Return at most 50 tasks per group page; read sessions and logs only for the selected task.
- Return at most 50 run records per page and automatically inspect at most two pages before explicit continuation.
- Load the creation form on demand; do not preload every Agent's conversation messages when the page opens.
- Use existing change events without a new polling timer, and do not remount the active conversation on list refresh.
- Reuse bulk display data and run summaries; do not add per-row log requests or per-Agent N+1 queries.

`queryTasks` currently reads candidates, filters and sorts them, then slices in the main process; this is not SQL-level pagination.
`getTaskLogs` similarly calls `jobService.list({ scheduleId })` before slicing. A bounded response does not bound the underlying scan.
Measure main-process time, request counts, and rendered items against the existing list with large task sets and long histories.
If repeated group scans cause noticeable stalls, address them within the owning service rather than transferring all tasks to the renderer or redesigning the scheduler.

### Delivery sequence

1. Confirm the implementation baseline and shared-form contract, then review the design, data, and frontend testing rules.
2. Add state filtering before pagination and expose log paging; verify totals, state precedence, and old-caller compatibility.
3. Add the entry, route, title, icon, and preference upgrade; adapt the existing conversation composition layer.
4. Connect the shared form, both task groups, pause and resume, association resolution, and empty states.
5. Verify the affected contracts, desktop behavior, accessibility, concurrency, and performance; update affected documentation and generated route materials.

## Alternatives considered

| Alternative | Reason not selected |
| --- | --- |
| Keep tasks only in settings | Does not provide the requested independent sidebar page or task-to-conversation workflow |
| Replace the right pane with task details or logs | Conflicts with the required associated conversation and its composer |
| Copy the whole #21849 stack or duplicate its form | Introduces unrelated changes or diverging validation when the shared form is already available |
| Group only the currently fetched 50 tasks | Produces incomplete groups, incorrect totals, and missing tasks on later pages |
| Classify using `enabled` alone | Mislabels completed or missed schedules as paused and discards the existing derived-state precedence |

## Acceptance criteria

- AC1 — New and upgraded installations have a working sidebar entry; upgrade preserves pinned entries and their order, and a removed entry stays removed after restart. (verification: unit + renderer + Electron; owner: sidebar implementer)
- AC2 — Add opens the centered Create modal; outside submission, Esc, Cancel, and focus return work; submission blocks dismissal and duplicates, while failure preserves values. (verification: renderer + Electron; owner: renderer implementer)
- AC3 — Successful creation closes the form and selects the new task without an extra run-now command or navigation to Settings or Agents; a never-run task shows the waiting state. (verification: renderer + Electron; owner: renderer implementer)
- AC4 — Both groups remain complete with more than 50 tasks, correct totals, and pause/resume movement that preserves selection; completed and missed tasks are not paused, and pausing does not terminate a started run. (verification: unit + renderer; owner: data implementer)
- AC5 — Empty tasks, missing conversations, and task switches never flash the previous task's messages; late responses cannot overwrite the selected task. (verification: renderer; owner: conversation implementer)
- AC6 — Reused sessions, latest valid runs, and explicit history resolve in order; records after the first 50 remain reachable within the search budget, and null IDs never open the Agent's unrelated latest session. (verification: unit + renderer; owner: conversation implementer)
- AC7 — Queued runs without sessions, deleted sessions, and background sessions have accurate feedback; new runs do not steal the active conversation, and users can explicitly switch to the latest one. (verification: renderer + Electron; owner: conversation implementer)
- AC8 — Continuing a conversation leaves the task prompt and schedule unchanged and preserves busy-state, approval, and same-session multi-view protections, including across windows. (verification: renderer + Electron; owner: conversation implementer)
- AC9 — Existing Agents, Settings, external links, and any landed task dashboard remain usable; leaving the task page does not stop scheduling or active execution. (verification: renderer + Electron; owner: feature implementer)
- AC10 — Light, dark, keyboard, and small-window use remain functional; group and log requests respect their budgets, with no added polling or per-row N+1 work and measured large-data scan costs. (verification: renderer + Electron + performance measurement; owner: feature implementer)

Implementation verification covers `AgentTaskService`, agents handlers, the entry seeder, the form, route adapters, association races, and affected existing consumers.
Database tests use `setupTestDatabase()`. Run targeted tests with explicit file paths, plus desktop checks for more than 50 tasks and histories, two views, and multiple windows.
This documentation change runs the docs gates only; none of the product criteria above is claimed as passed.

## Risks

- Route coupling: `AgentPage` and navigation ownership assume the Agents route. A partial adapter can redirect selection or duplicate a stream; keep the extraction small and verify both views and multiple windows.
- Scan cost: two filtered groups may repeat the existing task scan, and each log page may reread a long history. Measure those costs instead of describing response pagination as bounded database work.
- End-state placement: keeping `completed / missed` in Settings is a proposed default. If review changes it, update the same Spec and pagination contract; do not silently add a group or close an open conversation.
- Scheduled execution and user input may share a reused session. Preserve existing concurrency, busy-state, and approval rules; the new page must not bypass them or make pause appear to cancel active work.
