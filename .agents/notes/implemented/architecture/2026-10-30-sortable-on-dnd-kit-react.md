# Agent Note: Back Sortable with @dnd-kit/react

Status: implemented

English | [中文](2026-10-30-sortable-on-dnd-kit-react.zh.md)

## Problem

`Sortable` in `@cherrystudio/ui` runs on `@dnd-kit/core` 6.3.1, last published in December 2024. That API has no option to exclude nested controls from drag activation, so `Sortable` subclasses sensors and each consumer marks its controls with `data-no-dnd`. It also registers `PointerSensor` and `TouchSensor` together, which dnd-kit documents as alternatives: use `PointerSensor` with `touch-action: none`, or `MouseSensor` with `TouchSensor`.

PR #23117 exposed the cost. Removing `@hello-pangea/dnd` lost the built-in interactive-element blocking and long-press handling, and three review rounds then found one gap at a time. A mouse press on an action button started a drag. A touch hold on the same button did too. A Chromium probe then showed that a touch hold-and-drag on a row never reorders, on `main`'s `Sortable` as well: `PointerSensor` captures the touch, the row keeps `touch-action: manipulation`, and the browser's pan fires `pointercancel`. Every other `Sortable` list shares that sensor pair.

The Chromium 151 probe ran the same gestures against `@dnd-kit/react` 0.5.1 with no custom sensor and no drag handle. Touch hold-and-drag reordered, a touch swipe scrolled without entering a drag, holding a button did not drag, tapping the button clicked it, and mouse and keyboard reordering worked. That probe used a reduced page, not the Electron app.

## Decision

`Sortable` and `ReorderableList` run on `@dnd-kit/react`, with `@dnd-kit/react`, `dom`, `abstract`, `collision`, and `helpers` pinned to exactly 0.5.1. `ReorderableList` keeps its props and gains `isItemDragDisabled`, which refuses to drag a row while it keeps accepting drops, and takes that row out of the tab order. Selection Assistant moved here too, and the single-library change it belonged to is recorded in [Keep dnd-kit as the only drag-and-drop library](../simplification/2026-10-30-single-drag-and-drop-library.md).

| Earlier `Sortable` surface | Shipped surface |
| --- | --- |
| `DndContext` + `SortableContext` + sorting strategies | `DragDropProvider`; `useSortable` from `@dnd-kit/react/sortable` |
| `PortalSafePointerSensor`, `TouchSensor`, `KeyboardSensor` | Library `PointerSensor` and `KeyboardSensor`; only `PointerSensor.configure` options differ from the defaults |
| `restrictions.windowEdges` | `RestrictToWindow` |
| `restrictions.scrollableAncestor` | `RestrictToElement` bound to `getFirstScrollableAncestor` |
| Axis modifiers | `RestrictToVerticalAxis` / `RestrictToHorizontalAxis` |
| `accessibility` | Neutral `SortableAccessibility`, mapped onto the `Accessibility` plugin |
| `DragOverlay`, ghost, `adjustScale` | `DragOverlay`; `adjustScale` is gone because the overlay box no longer scales its content |
| `collisionDetection` | `collisionDetection="closest-center"`, mapped to `collisionDetector` on each item |
| Public `Active`, `Over`, `Modifier`, `CollisionDetection` types | `onDragStart({ activeId })`, an argument-free `onDragEnd`, and no `modifiers` prop |
| `dragHandleProps` `{ ref, attributes, listeners }` | `{ ref }` backed by `handleRef`; the four `dragHandle` consumers dropped their spreads |

These decisions go beyond the Spec table, and each exists because a probe failed without it:

- React owns the order during a drag. `Sortable` holds preview ids and calls `preventDefault` on `dragover`, because the library's optimistic plugin moves DOM nodes and has no way back when a consumer rejects a drop. A `dragover` that arrives after the drop is ignored, because the status stays `dragging` until the drop renders.
- After each preview move, the drop target resets to the source with collisions paused, as the library's plugin does. Otherwise the row that just shifted stays the target and re-entering its new slot fires no `dragover`.
- A drop commits the order on screen, even when `target` is null. Auto-scroll can carry the rows out from under the pointer, and refusing then would snap back a row the user sees in place.
- Mouse activation is a distance of 8 px. The library default also activates after a 200 ms hold, which would swallow a slow click on a row. Touch keeps the library's 250 ms delay with a 5 px tolerance.
- `preventActivation` wraps the library default with two markers. `data-dnd-row-control` marks a button that is the row itself (sidebar entries, launchpad tiles, provider group headers), which would otherwise never drag. `data-no-dnd` marks a non-control region of a row, and now applies only to rows that contain it, so a nested list inside the marked region still drags. Controls inside a row need no marker.
- The first touch move and the drop each dispatch a synthetic `pointermove` on the activator. Pointer capture on `<body>` hides the gesture from the row, so a Radix `ContextMenu` long-press timer would otherwise open a modal menu after the finger moved or lifted, and leave `<body>` at `pointer-events: none`. Holding still past 700 ms keeps the long-press menu.
- Window blur stops the operation through the drag manager and then calls `destroy()` on each sensor. Sensors stay attached after an outside stop, and only they know about a press that has not activated.

`BlurCancelPointerSensor` stays exported for the `@dnd-kit/core` consumers. `GroupedSortableVirtualList`, the knowledge navigator, the shared `arrayMove` callers, and `useDndState` stay on `@dnd-kit/core`.

## Alternatives considered

- `pointerType === 'touch'` rejection in `PortalSafePointerSensor`: passed the probe with one condition, but keeps the unsupported sensor pair and works around it.
- `MouseSensor` + `TouchSensor` with custom subclasses: passed the probe and matches the legacy docs, but keeps a custom activator for each input type, re-implements blur cancel on `MouseSensor`, and leaves every consumer marking its controls by hand.
- A dedicated drag handle on the Selection Assistant list: removes the nested-control problem for that list without new dependencies, but changes whole-row dragging to a grip, and does not repair the sensor pair for other lists. Rejected as an unwanted product change.
- Keep `@hello-pangea/dnd` for this list: it passed every gesture, but abandons the single-library goal of PR #23117 and leaves its unused dependencies in place.
- Migrate every dnd-kit consumer at once: touches 14 source files and puts the unproven virtual list in the same change as the proven path. If the virtual list fails, everything waits.
- Rely on the library's optimistic sorting plugin: reorders with less code, but a rejected or failed drop leaves the DOM out of step with `items`.
- Treat a row-as-button with a per-list prop: `ProviderListContent` mixes group headers that are buttons with rows holding nested controls, so the choice has to be per element.
- Make the Selection Assistant row a `dragHandle`: the library stops excluding controls inside a handle, so the edit button would start drags again.
- Clear the long-press timer at drag start: simpler, but a drag activates at 250 ms, so touch users would lose row context menus entirely.

## Consequences

Touch hold-and-drag now works in every `Sortable` list. `Sortable` ships two dnd-kit generations until a later Spec removes the old one. Replacing `@hello-pangea/dnd` nets about 10 KB gzip: about 40 KB added, about 29 KB removed, measured on a standalone esbuild bundle and the published UMD file rather than the app build. `@dnd-kit/react` is pre-1.0, so upgrades need these probes rerun, and `sensor.destroy()` depends on 0.5.1 leaving sensors reusable, which a unit test guards.

Dropping after the pointer leaves every row now commits the last shown position; `@dnd-kit/core` snapped back. Row attributes (`role`, `tabindex`, `aria-*`) now arrive on a scheduler tick on the row's outer element, so tests use `findByRole`. A touch hold longer than 700 ms on a row with a context menu opens the menu while the drag is active; lifting ends the drag without a move. In a popover, Escape during a keyboard drag also closes the popover, because Radix handles it first; no reorder commits.

Tests that use the real sensors need `installDndDomStubs`, because jsdom lacks the pointer, animation, and scrolling APIs. Windows, physical touchscreens, and an OS-level focus steal were not exercised. Touch evidence comes from CDP-dispatched events on macOS. `QueuedFollowupsDock` was not exercised in the app because it needs an active generation; it is a plain `ReorderableList` consumer covered by renderer tests.

## Verification

- AC1 — Electron probe with CDP touch events (sidebar, provider list, launchpad, MiniApp settings, Code providers, Prompt settings, both prompt dialogs): touch hold-and-drag reorders, and a touch swipe over the provider list scrolls with the order unchanged.
- AC2 — Electron probe plus `packages/ui/src/components/composites/sortable/__tests__/sortable.test.tsx`: mouse and touch presses on the provider kebab, composer switch, and Selection Assistant edit button start no drag, the MCP switch and Code card button refuse a mouse drag, and a click and a CDP tap on the edit button still open its dialog.
- AC3 — `sortable.test.tsx` (`uses only the library sensors`): the manager's sensors are exactly `PointerSensor` and `KeyboardSensor`; `PortalSafePointerSensor` is deleted.
- AC4 — Electron probe plus `sortable-keyboard.test.tsx`: Space and arrow keys reorder the provider list, launchpad, composer list, Prompt settings, and Selection Assistant, and IME composition keys in a nested input start no drag.
- AC5 — `sortable.test.tsx` (`window blur` group) plus an Electron probe dispatching `blur`: active pointer and keyboard drags cancel and restore the order, a pending press cannot start a drag, the next key is not swallowed, a new drag can start, and a later click reaches the page.
- AC6 — Electron probe: provider list (flat, grouped, nested group rows, compact overlay, auto-scroll), launchpad grid, composer toolbar list, Prompt settings, `PromptBindingTab`, and `PaintingPromptPresetsDialog` reordered within their restrictions and showed an overlay, and ghost opacity was checked on the MCP list; the two dialogs ran inside real Radix modals. Appearance was not compared side by side with `main`.
- AC7 — Electron probe plus `sortable.test.tsx` (`announces through localized strings`): the composer list's localized Chinese strings reach its own live region for pick-up and drop.
- AC8 — Electron probe with the macOS Accessibility gate temporarily bypassed: whole rows drag, long drags across the divider in both directions matched a computed expected order in 7 of 7 runs, the divider and last enabled action refuse dragging but accept drops, and results persist to `feature.selection.action_items`.
- AC9 — `pnpm test:renderer` on `GroupedSortableVirtualList.test.tsx` and `BaseNavigator.test.tsx`: both still run on `@dnd-kit/core` and pass.
- Regression — `sortable.test.tsx`: removing each fix on the final code fails a test, confirmed by mutation; the exception is `dragover` `preventDefault`, which the library also tolerates through its own index check.
