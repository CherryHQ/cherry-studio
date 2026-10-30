# Agent Note: Back Sortable with @dnd-kit/react

Status: proposed

English | [中文](2026-10-30-sortable-on-dnd-kit-react.zh.md)

## Problem

`Sortable` in `@cherrystudio/ui` runs on `@dnd-kit/core` 6.3.1, last published in December 2024. That API has no option to exclude nested controls from drag activation, so `Sortable` subclasses sensors and each consumer marks its controls with `data-no-dnd`. It also registers `PointerSensor` and `TouchSensor` together, which dnd-kit documents as alternatives: use `PointerSensor` with `touch-action: none`, or `MouseSensor` with `TouchSensor`.

PR #23117 exposed the cost. Removing `@hello-pangea/dnd` lost the built-in interactive-element blocking and long-press handling, and three review rounds then found one gap at a time. A mouse press on an action button started a drag. A touch hold on the same button did too. A Chromium probe then showed that a touch hold-and-drag on a row never reorders, on `main`'s `Sortable` as well: `PointerSensor` captures the touch, the row keeps `touch-action: manipulation`, and the browser's pan fires `pointercancel`. Every other `Sortable` list shares that sensor pair.

The Chromium 151 probe ran the same gestures against `@dnd-kit/react` 0.5.1 with no custom sensor and no drag handle. Touch hold-and-drag reordered, a touch swipe scrolled without entering a drag, holding a button did not drag, tapping the button clicked it, and mouse and keyboard reordering worked. That probe used a reduced page, not the Electron app.

## Proposal

Replace the internals of `Sortable` and its item rendering with `@dnd-kit/react`, pinned to an exact version with `@dnd-kit/helpers` and `@dnd-kit/collision` as needed. `ReorderableList` keeps its API. Interactive-element exclusion and touch activation come from the library's `PointerSensor` defaults or documented options.

| Current `Sortable` surface | Target |
| --- | --- |
| `DndContext` + `SortableContext` + sorting strategies | `DragDropProvider`; `useSortable` from `@dnd-kit/react/sortable` |
| `PortalSafePointerSensor`, `TouchSensor`, `KeyboardSensor` | Library `PointerSensor` and `KeyboardSensor` |
| `restrictions.windowEdges` | `RestrictToWindow` |
| `restrictions.scrollableAncestor` | `RestrictToElement` bound to the nearest scrollable ancestor |
| Axis modifiers | `RestrictToVerticalAxis` / `RestrictToHorizontalAxis` |
| `accessibility` | `Accessibility` plugin options |
| `DragOverlay`, ghost, `adjustScale` | `DragOverlay` and `Feedback` options that keep the current appearance |
| `collisionDetection` | `collisionDetector` on the sortable item |
| Public `Active`, `Over`, `Modifier`, `CollisionDetection` types | Neutral props owned by `@cherrystudio/ui` |
| `dragHandleProps` `{ ref, attributes, listeners }` | `{ ref }` backed by `handleRef`; the four `dragHandle` consumers drop their spreads |

`BlurCancelPointerSensor` stays exported for the `@dnd-kit/core` consumers below. `Sortable` no longer uses it. `@dnd-kit/react` 0.5.1 has no window-blur cancel, so `Sortable` cancels the operation from a window `blur` listener through its drag manager rather than a sensor subclass.

Out of scope, staying on `@dnd-kit/core`: `GroupedSortableVirtualList`, the knowledge navigator, and the shared `arrayMove` callers. Removing `@dnd-kit/core` needs its own Spec, because the new API has no `SortableContext` and items register on mount, so a list that unmounts off-screen rows has not been shown to work. `useDndState` has no application callers and stays on `@dnd-kit/core`.

PR #23117 stacks on the implementation, drops `PortalSafeTouchSensor` and the `data-no-dnd` marker on the Selection Assistant action section, and keeps whole-row dragging.

## Alternatives considered

- `pointerType === 'touch'` rejection in `PortalSafePointerSensor`: passed the probe with one condition, but keeps the unsupported sensor pair and works around it.
- `MouseSensor` + `TouchSensor` with custom subclasses: passed the probe and matches the legacy docs, but keeps a custom activator for each input type, re-implements blur cancel on `MouseSensor`, and leaves every consumer marking its controls by hand.
- A dedicated drag handle on the Selection Assistant list: removes the nested-control problem for that list without new dependencies, but changes whole-row dragging to a grip, and does not repair the sensor pair for other lists. Rejected as an unwanted product change.
- Keep `@hello-pangea/dnd` for this list: it passed every gesture, but abandons the single-library goal of PR #23117 and leaves its unused dependencies in place.
- Migrate every dnd-kit consumer at once: touches 14 source files and puts the unproven virtual list in the same change as the proven path. If the virtual list fails, everything waits.

## Acceptance criteria

- AC1 — In `Sortable` lists, a touch hold-and-drag on a row reorders the list, and a touch swipe over rows scrolls without starting a drag. (verification: Electron)
- AC2 — Pressing, holding, or dragging from a button or other interactive control inside a row starts no drag for mouse or touch, and a click or tap still activates the control. (verification: Electron)
- AC3 — `Sortable` registers no sensor subclass, and `PortalSafePointerSensor` no longer exists. (verification: unit)
- AC4 — Keyboard reordering with Space and arrow keys still reorders, and IME composition keys in a nested input start no drag. (verification: renderer)
- AC5 — An active `Sortable` drag cancels when the window loses focus, and later clicks reach the page. (verification: renderer)
- AC6 — The provider list, launchpad grid, and each `dragHandle` consumer keep their current reorder results, axis and boundary limits, overlay, and ghost. (verification: Electron)
- AC7 — Localized drag announcements passed through `accessibility` still reach the live region. (verification: renderer)
- AC8 — In Selection Assistant settings, whole rows drag, and the divider and the last enabled action cannot be dragged but still accept drops. (verification: Electron)
- AC9 — `GroupedSortableVirtualList` and the knowledge navigator keep working on `@dnd-kit/core`. (verification: renderer)

## Risks

- `@dnd-kit/react` is pre-1.0, so a minor release can break the API. An exact version pin keeps upgrades deliberate. Open upstream issues touch this path: #1723 reports touch problems when dragging between columns, and #2118 reports the keyboard sensor locking out the mouse.
- Per-row control is unproven. The Selection Assistant divider and last enabled action must stay droppable while refusing to drag, and the probe did not cover that with `@dnd-kit/react`.
- `@dnd-kit/react` 0.5.1 has no `restrictToFirstScrollableAncestor` equivalent, so the `RestrictToElement` mapping must find the scrollable ancestor itself. Six consumers pass `restrictions`.
- Drag overlay appearance, drop animation, right-click behavior, and menus rendered through portals were not probed. A difference that cannot be matched returns to this Spec.
- `Sortable` and its `@dnd-kit/core` neighbors ship two dnd-kit generations together until a later Spec removes the old one. The bundle-size cost is unmeasured.
- Tests that mock `@dnd-kit/core` for `Sortable` behavior need rewriting, which weakens regression coverage during the change. Rollback is a revert of the implementation PR; no stored data changes.
