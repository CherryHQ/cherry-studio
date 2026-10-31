# Agent Note: Keep dnd-kit as the only drag-and-drop library

Status: implemented

English | [中文](2026-10-30-single-drag-and-drop-library.zh.md)

## Problem

The renderer shipped two drag-and-drop libraries. `@dnd-kit/*` backs `Sortable`, `ReorderableList`, the tree view, and the grouped virtual lists. `@hello-pangea/dnd` remained only in the Selection Assistant actions settings (four files) and in `@cherrystudio/ui`'s `DraggableList` (476 lines), which no application code imported; only its Storybook story did. The second library also pulled `redux`, `react-redux`, `css-box-model`, and `raf-schd` into the dependency graph, and the data-layer docs showed a `<DraggableList items onReorder>` usage that matched neither real API.

## Decision

Remove `@hello-pangea/dnd` and `DraggableList`. The Selection Assistant actions list is one `ReorderableList` whose rows are `[...enabled, ACTIONS_DIVIDER, ...disabled]`. The divider is a sentinel row: it renders `ActionsListDivider`, and `isItemDragDisabled` refuses to drag it while it stays a sortable drop target. `actionItemsFromRows` derives `enabled` from each row's side of the divider and moves enabled rows beyond `MAX_ENABLED_ITEMS` (8) to the end of the disabled list. `isItemDragDisabled` also refuses the last enabled action, preserving the rule that at least one action stays enabled. The list runs on the `@dnd-kit/react` `Sortable` described in [Back Sortable with @dnd-kit/react](../architecture/2026-10-30-sortable-on-dnd-kit-react.md). Data-layer examples now show `ReorderableList`.

## Alternatives considered

- Two `SortableContext`s under one `DndContext` with `onDragOver` moving items between containers (the dnd-kit multiple-containers pattern): rejected because `Sortable` owns its `DndContext`, so the page would hand-write roughly a hundred lines of dnd-kit wiring to keep two visual boxes.
- Reuse `GroupedSortableVirtualList`: rejected; a 1346-line virtualized grouped list is disproportionate for about ten rows.
- Add multi-container support to `@cherrystudio/ui` `Sortable`: rejected; one consumer does not justify a new shared API.

## Consequences

Enabled and disabled actions now live in one list separated by a row, not in two boxes. Dropping an action on the divider from above disables it and from below enables it. Drag feedback uses dnd-kit's overlay and ghost instead of hello-pangea's placeholder, and screen-reader announcements fall back to dnd-kit's English defaults, as hello-pangea's did. `DraggableList` and `useDraggableReorder` are no longer exported from `@cherrystudio/ui`.

## Verification

- Regression — `pnpm test:renderer src/renderer/pages/settings/SelectionAssistantSettings/hooks/__tests__/useSettingsActionsList.test.ts`: crossing the divider rewrites `enabled`, dropping on the divider works in both directions, and overflow past 8 enabled actions moves to the end of the disabled list.
- Electron probe — Settings → Selection Assistant in a development build, driven over CDP: in-list reorder, enabled↔disabled drags, divider drops in both directions, a non-draggable divider and last enabled action, the edit button, and keyboard reordering all behaved as described and persisted to `feature.selection.action_items`.
