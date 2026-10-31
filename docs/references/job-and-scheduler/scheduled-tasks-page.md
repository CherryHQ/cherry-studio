---
description: Scheduled tasks page navigation, conversation selection, pagination, and upgrade behavior
sources:
  - src/renderer/pages/agents/ScheduledTasksPage.tsx
  - src/renderer/pages/agents/AgentChat.tsx
  - src/renderer/pages/agents/components/ScheduledTaskSidebar.tsx
  - src/renderer/components/app/sidebarIcons.tsx
  - src/renderer/hooks/agent/useTaskConversation.ts
  - src/renderer/services/taskConversation.ts
  - src/main/data/services/AgentTaskService.ts
  - src/main/data/db/seeding/seeders/scheduledTasksShortcutSeeder.ts
---

# Scheduled tasks page

English | [中文](scheduled-tasks-page.zh.md)

## Use the page

Open Scheduled tasks from the global sidebar. Select a task in Active or Paused to read and continue its associated conversation. Each group has its own pagination, total, loading state, and retry action. Completed and missed tasks remain available in Settings.

Add scheduled task opens the shared creation form in the current window. Successful creation selects the returned task without an extra run command. A task with no execution shows a waiting state. Pausing affects future scheduling; it does not cancel an execution already in progress.

Each group can collapse independently without changing the open conversation. The three-dot menu on each task offers Continue or Pause, Run now, Edit, and Delete. Delete uses destructive styling and requires confirmation. Editing opens the shared form with the current task values. Deleting the selected task clears its route selection; deleting another task leaves the current conversation unchanged.

## Sidebar and conversation header

The sidebar follows the Agents page's surface, spacing, and list interaction patterns. It uses the shared background token: white in the default light theme and theme-dependent in other modes. The selected global entry uses a filled calendar with contrasting clock details.

Each task row shows its name, followed by its owning Agent and schedule. The secondary line shares the available width according to content instead of forcing equal halves. Long text stays on one line with an ellipsis; hovering exposes the full value. The task and its three-dot control share one hover and selection background. Actions appear on hover or keyboard focus and remain visible on touch devices.

The right-side header contains the task name, execution summary, run selector, and applicable history actions. It replaces the Agent, model, and workspace controls on this page only. Message sender information and the conversation composer remain unchanged. Selecting a task or collapsing a group does not start an execution.

## Conversation selection

- The route stores `taskId` and an optional `runId`. A URL `sessionId` is not accepted as proof of ownership.
- An explicit run must belong to the selected task. Its missing or deleted conversation is not replaced with another run.
- Otherwise, a valid bound reuse session takes priority over the most recent available execution conversation.
- Automatic lookup reads at most two pages of 50 logs. Continue searching loads one additional page. Reaching the automatic budget does not mean history is exhausted.
- A new execution offers an explicit switch; it does not replace the conversation being read or edited. Switching tasks invalidates the previous lookup.
- Conversation messages, tools, approvals, and busy-state protection use the existing Agent chat runtime. Leaving the page does not stop scheduling.

## Read and command boundaries

`GET /agent-tasks` accepts optional `status`: `active`, `paused`, `completed`, or `missed`. Omission preserves the existing unfiltered list. The service derives and filters status before counting and slicing; it still scans candidate schedules in the main process.

Task lists return at most 50 items per group on this page. Only the selected task loads execution history and conversation messages. Log pages use the existing job service's SQL limit, offset, and count. Run summaries and Agent names use batch reads; the page adds no polling timer.

Creation, pause, resume, explicit execution, editing, and deletion use the existing `ai.agent.task.*` commands. Opening the menu does not execute a command. Conversation messages do not update the task prompt or schedule.

## Shortcut upgrades

New installations receive the default `core.app` shortcut. A versioned seeder inserts it once into existing `ui.sidebar_shortcut` lists, after Chat and Agents when present, without reordering existing items. An existing task shortcut stays in place. Removing the shortcut after this upgrade is respected on restart.

The [Spec](../../../.agents/notes/proposed/feature/2026-10-31-scheduled-tasks-page.md) owns the rationale and acceptance criteria.
