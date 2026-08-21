# Scheduled Tasks Scroll Layout Design

## Goal

Keep the scheduled-task list controls visible while a long task list scrolls in the lower portion of the settings pane. The scrollbar must sit on the right edge of that lower pane rather than beside the centered content column.

## Layout

The base `/settings/scheduled-tasks` route becomes a bounded vertical flex layout. Its top section contains the existing title, search control, filters, and create-task menu. It is a normal non-scrolling sibling, not a CSS sticky element.

The lower section occupies the remaining height with `min-h-0 flex-1` and uses the shared `Scrollbar` component. The list, empty states, and pagination are children of that scrollbar. Inside it, a centered `max-w-3xl` content wrapper keeps the task cards aligned with the top controls; outer padding preserves the current page gutters.

## Scope and Constraints

Only the list route changes. Task-detail rendering, task data reads, filtering, pagination, dialogs, and status presentation remain unchanged. The list must still work when no tasks exist, when filters have no matches, and when the top controls consume additional height on narrow windows.

The implementation removes the list's hand-written `overflow-y-auto` and scrollbar styling, using the existing shared scrollbar behavior instead. This follows the fixed-toolbar plus lower-scroll-region pattern used by MCP settings.

## Verification

Run the targeted renderer test for `TasksSettings` to ensure list and route behavior remain intact. Then inspect the scheduled-task list in the tracked Electron development instance with enough entries to overflow: the controls remain visible, only the lower content scrolls, and the scrollbar is at the right edge of the settings pane.
