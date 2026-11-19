# Agent Note: Move the grouped drag lists to @dnd-kit/react

Status: proposed

English | [中文](2026-11-19-grouped-drag-lists-on-dnd-kit-react.zh.md)

## Problem

[Back Sortable with @dnd-kit/react](../../implemented/architecture/2026-10-30-sortable-on-dnd-kit-react.md) moved `Sortable` and `ReorderableList` to `@dnd-kit/react` 0.5.1 and left the rest on `@dnd-kit/core` 6.3.1 for a later Spec. The renderer still ships both generations:

- `GroupedSortableVirtualList` backs `ResourceListVirtual`, which renders the Topics and Sessions sidebars, the busiest drag lists in the app.
- The knowledge navigator (`BaseNavigatorContent`, `BaseNavigatorGroupSection`, `SortableKnowledgeBaseRow`) runs its own `DndContext`.
- `@cherrystudio/ui` exports `BlurCancelPointerSensor` for those two callers and `useDndState`, which no application code imports; only the package README mentions it.
- `Sidebar` and `LaunchpadPage` import `arrayMove` from `@dnd-kit/sortable`.

Both lists keep the sensor shape `Sortable` replaced. `GroupedSortableVirtualList` registers a `BlurCancelPointerSensor` subclass whose activator rejects only non-primary buttons and Control-click, so a press on a row's pin or menu button that moves 6 px starts a drag. The knowledge navigator uses `BlurCancelPointerSensor` directly. Neither list sets touch activation, and the `Sortable` probe showed that a pointer sensor alone loses a touch drag once the browser starts panning. The fixes `Sortable` proved in the Electron app are private to `sortable.tsx`: mouse and touch activation constraints, `preventActivation` with its two markers, window-blur cancel, and the synthetic `pointermove` that stops a Radix `ContextMenu` long-press timer. Rows in both lists carry context menus, so they need the same fixes.

The earlier Spec deferred these lists because a virtual list unmounts off-screen rows and `@dnd-kit/react` registers items on mount. A probe on 2026-11-19 answered that. It ran a reduced page in headless Chromium through Playwright with real mouse and keyboard input: 200 rows of 30 px in a 300 px scroller, `@tanstack/react-virtual` 3.13.24 with overscan 2, each row a `useDraggable` and `useDroppable` on one element, and a `DragOverlay`.

- Auto-scroll carried the source row out of the rendered range. The drag stayed active, the overlay stayed visible, and `onDragEnd` reported the source and target.
- With the source row unmounted, a drop after scrolling to the end reported target 194 while the pointer was over row 195. With the source row kept mounted through the range extractor, both runs reported the row under the pointer.
- A keyboard drag auto-scrolled past the viewport.
- A new drag started immediately after a drop, with and without a drop animation.

## Proposal

Move both lists to `@dnd-kit/react` 0.5.1 on a drag root shared with `Sortable`, then remove `@dnd-kit/core`, `@dnd-kit/sortable`, and `@dnd-kit/utilities`.

### Shared drag root

`@cherrystudio/ui` exports `DragDropRoot`, a `DragDropProvider` that fixes the sensors and owns the behavior `Sortable` proved:

- The library `PointerSensor` and `KeyboardSensor`. Mouse activates after 8 px; touch keeps the 250 ms delay with a 5 px tolerance.
- `preventActivation` keeps the `data-no-dnd` and `data-dnd-row-control` markers and also rejects Control-click, which macOS turns into a context menu. That rule moves out of the virtual list's sensor subclass and now applies to every `Sortable` list as well.
- A window `blur` stops the operation through the manager and destroys the sensors.
- The first touch move and the drop dispatch the synthetic `pointermove` on the activator.

Callers pass their own handlers, modifiers, and plugins. `Sortable` renders `DragDropRoot` instead of wiring these itself. The package also exports `BUTTON_HANDLE_DRAG_SENSORS`, the same pointer sensor with a keyboard sensor that starts only on Space, for a draggable whose handle is a button: the library's Enter would otherwise start a drag instead of clicking it.

### Insertion-line lists

Neither list previews a new order. Both mark the insertion point with a line before or after the target row, so they stay off `Sortable` and its preview reordering. A draggable row registers through `useSortable` with `SortableKeyboardPlugin` as its only plugin: arrow keys step one row per press, as the knowledge navigator does today, and without `OptimisticSortingPlugin` no row moves in the DOM. In the virtual list, a row that cannot be dragged registers only a droppable and carries no drag `role`, `tabindex`, or `aria-*`, keeping the contract from PR #24869.

The line's side keeps today's rule, the dragged row's vertical center against the target's. The dragged center comes from the start shape plus the drag transform, because the measured shape trails each move by a frame. A keyboard step aligns the two centers, so a tie within 1 px takes the direction of the move. Each row reads its own side through `useComputed`, so a move re-renders only the target row, and the drop handler applies the same rule to the final operation.

`GroupedSortableVirtualList`:

- Keeps its props, drag payloads, `canDrag*` and `canDrop*` callbacks, drag capabilities, blocked-group state, group append targets, and overlay sizing. Its id type becomes `string | number` owned by the component instead of `UniqueIdentifier` from `@dnd-kit/core`. `dragActivationDistance` is removed; no caller passes it, and activation comes from `DragDropRoot`.
- Passes the source row's index to `DynamicVirtualList`'s existing `keepMountedIndexes` during a drag, so the source stays mounted while auto-scroll moves the list.
- Marks group header buttons that start a drag with `data-dnd-row-control`. Item rows are `div`s and need no marker.

The knowledge navigator:

- Uses the row's main button as the drag handle for bases and groups, as today, with `BUTTON_HANDLE_DRAG_SENSORS`, so Enter still selects a base and Space picks it up, matching today's keyboard codes.
- Expresses its collision rules with `type`, `accept`, and `collisionPriority` instead of a custom detector. A group accepts only groups while a group drags, and a base row wins over the group section that contains it.
- Stops shifting rows during a drag. The insertion line it already draws becomes the only preview, as in the virtual list.

### Tests

`GroupedSortableVirtualList` and knowledge navigator ordering tests run on the real library with the DOM stubs the `Sortable` tests use, moved to `tests/__mocks__/dndDomStubs.ts` so both the renderer and `@cherrystudio/ui` test projects import them. jsdom never fires the observers that measure drop targets, so these tests measure them explicitly. `ResourceList`, `Topics`, and `Sessions` tests each carry a copy of the same `@dnd-kit/core` mock today. They drop those mocks and drive the real library through one shared driver, `tests/__mocks__/dndDriver.tsx`: the renderer setup's `@cherrystudio/ui` mock renders the real `DragDropRoot` with a probe that records its manager, and the driver picks a row up with Space, places the target above or below the dragged row, and drops. Assertions that only record mock calls are deleted, not ported.

### Dependencies

`arrayMove` comes from `@dnd-kit/helpers`. The root manifest adds `@dnd-kit/abstract`, `@dnd-kit/dom`, `@dnd-kit/helpers`, and `@dnd-kit/react` pinned to 0.5.1 in `devDependencies`, the same versions `@cherrystudio/ui` pins, so the renderer and the package resolve one instance and share one drag context. The final layer updates the `Sortable` note's statements about the remaining `@dnd-kit/core` callers.

### Stack

| Layer | Change | ACs |
| --- | --- | --- |
| 1 | Delete `useDndState` and its README entry; import `arrayMove` from `@dnd-kit/helpers` | part of AC12 |
| 2 | Add `DragDropRoot`; `Sortable` renders it | AC11 |
| 3 | Move the knowledge navigator | AC5–AC10 for the navigator |
| 4 | Move `GroupedSortableVirtualList` and its tests | AC1–AC4, AC6–AC10 for Topics and Sessions |
| 5 | Delete `BlurCancelPointerSensor` and the legacy packages; move this note to implemented | AC12 |

## Alternatives considered

- Remove only the dead code and leave both lists on `@dnd-kit/core`: the smallest change, but it keeps two generations, a custom sensor, and the nested-control and touch gaps in the two busiest lists.
- Build both lists on `Sortable` or the library's sortable plugin: neither list shifts rows or previews an order, and groups, group drags, and cross-group appends do not fit a single flat list.
- Let the library keep an unmounted source row: the drag survives, but the probe's target lagged one row after a long auto-scroll. Keeping one extra row mounted removes the lag.
- Move the knowledge navigator onto `GroupedSortableVirtualList`: one drag implementation, but it replaces the navigator's accordion and row layout, a product change outside this Spec.
- Decide the line's side from the pointer instead of the dragged shape: simpler to state, but it moves the flip point for every existing user and breaks the MP-54 regression test that covers moving from a row's lower half to its upper half.
- Port each test file's mock to the new event shape: four copies of one mock again, each free to drift from the library separately.

## Acceptance criteria

- AC1 — In Topics and Sessions, a mouse drag reorders items within a group, moves an item to another group where the list allows it, and reorders session groups; the insertion line follows the pointer within a row, and the saved order matches the line. (verification: Electron)
- AC2 — A Topics or Sessions drag that auto-scrolls the source row out of view keeps the overlay and drops where the insertion line points. (verification: Electron)
- AC3 — A target refused by `canDropItem`, `canDropGroup`, or a disabled drag capability shows the blocked state, and dropping there changes nothing. (verification: renderer)
- AC4 — A row that cannot be dragged carries no drag `role`, `tabindex`, or `aria-disabled`, and its click still runs. (verification: renderer)
- AC5 — In the knowledge navigator, a mouse drag reorders bases within a group, moves a base before or after a row in another group or onto a group header to append it last while opening a collapsed group, and reorders groups. (verification: Electron)
- AC6 — In both lists, pressing a control inside a row starts no drag for mouse or touch, and the control still activates; a group header that is itself a button still drags. (verification: Electron)
- AC7 — On macOS, Control-click on a row in Topics, Sessions, or the knowledge navigator opens its context menu and starts no drag. (verification: Electron)
- AC8 — In both lists, a touch hold-and-drag reorders, a touch swipe scrolls without dragging, and the row context menu stays closed once the finger has moved. (verification: Electron)
- AC9 — In both lists, Space picks up a row, each arrow key press moves the insertion line one row, Space drops, and Escape cancels without changing the order. (verification: renderer)
- AC10 — In both lists, a window blur cancels an active or pending drag, and later clicks reach the page. (verification: renderer)
- AC11 — `Sortable` keeps its behavior on `DragDropRoot`: `sortable.test.tsx` and `sortable-keyboard.test.tsx` pass with only their DOM-stub import path changed. (verification: unit)
- AC12 — No source file, test, or package manifest references `@dnd-kit/core`, `@dnd-kit/sortable`, or `@dnd-kit/utilities`, and `@cherrystudio/ui` exports neither `BlurCancelPointerSensor` nor `useDndState`. (verification: repository check)

## Risks

- `@dnd-kit/react` is pre-1.0. The probe used a reduced page, not the Electron app, and did not exercise touch in a virtual list; AC2 and AC8 close that gap in the app.
- Knowledge navigator rows stop shifting during a drag. The insertion line already marks the target, but the change is visible.
- Mouse activation moves from 6 px to 8 px in both lists, and Control-click no longer starts a drag in any `Sortable` list. Arrow keys in Topics and Sessions step a row per press instead of 25 px.
- The shared test double can drift from the library's real events. `GroupedSortableVirtualList` and `BaseNavigator` tests run on the real library to catch that.
- The bundle-size gain from dropping three packages is unmeasured.
- Rollback is a revert of the affected layer. No stored data, order format, or persistence API changes.
