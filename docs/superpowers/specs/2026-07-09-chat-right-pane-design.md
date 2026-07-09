# Chat Right Pane Redesign

## Goal

Redesign the ordinary chat right pane so the top-bar pane entries remain the single place for opening, switching, and closing right-pane views. The right pane itself should show only the active view, a title, and pane-level controls.

## Scope

This change applies only to the ordinary chat page's Chat Right Pane. Agent Right Pane behavior stays unchanged, including its tab strip, status preview shortcut, files toggle, and dynamic flow tabs.

## Terms

- **Chat Right Pane**: the auxiliary panel attached to the ordinary chat area.
- **Pane Entry**: a top-bar control outside the Chat Right Pane that opens, switches, or closes a right-pane view.
- **Right-Pane View**: one selectable content surface inside the Chat Right Pane.
- **Chat Right Pane Header**: the control row inside the Chat Right Pane.

## Confirmed Behavior

Pane entries stay outside the Chat Right Pane in the chat top-right tool area.

- Resource entry remains the existing compact "conversation + count" pill.
- Branch and Trace entries remain icon-only controls.
- While the pane is docked and open, all available pane entries remain visible outside the pane.
- The active pane entry has an active visual state.
- Clicking the active pane entry closes the Chat Right Pane.
- Clicking a different pane entry keeps the pane open, preserves its width, and switches the active view.
- When the pane is maximized, external pane entries are hidden.

The Chat Right Pane Header uses title mode instead of a tab strip.

- Left side: the active view title.
- Right side: maximize or restore button, then close button.
- Maximized mode keeps the same header structure.
- The close button closes the whole Chat Right Pane.

View titles reuse existing labels.

- Resources: the resource entry label, such as `chat.topics.title`.
- Branch: `chat.message.flow.title`.
- Trace: `trace.label`.

Pane entry accessibility labels and tooltips keep the original view name even when clicking the active entry closes the pane.

## Implementation Shape

Use behavior props on the shared `Shell.TabList`, not business props such as `isChat` or `isAgent`.

Add a narrow title-mode API to `Shell.TabList`, for example:

```tsx
<Shell.TabList title={activeTitle} showTabs={false} />
```

Defaults preserve existing behavior:

- `showTabs` defaults to `true`.
- Existing Agent Right Pane callers do not pass the new props and keep the tab strip.
- Ordinary chat `TopicRightPane` passes `showTabs={false}` and the active title.

Adjust ordinary chat wiring:

- Remove `ResourcePaneShortcut` and `TopicRightPaneShortcuts` from the pane header trailing cluster.
- Keep pane entries in the chat top-right tool area while docked open.
- Hide pane entries while maximized.
- Let `ResourcePaneCountButton` support the same toggle-active behavior as icon pane entries.
- Give the active resource entry a neutral selected pill style without changing its shape.

## Verification

Focused tests should cover:

- Ordinary chat pane entries remain visible while the docked right pane is open.
- Active icon pane entry is visually active and clicking it closes the pane while preserving the view name label.
- Clicking another icon pane entry switches view without closing the pane.
- Resource count entry stays visible while docked open, becomes active for the resource view, and closes the pane when active.
- Chat Right Pane Header shows the active view title, maximize or restore, and close.
- Maximized pane hides external pane entries and still shows title, restore, and close.
- Agent Right Pane still renders its existing tab strip and shortcuts behavior.
