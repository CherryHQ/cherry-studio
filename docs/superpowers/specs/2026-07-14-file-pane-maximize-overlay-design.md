# File-only right-pane maximize overlay

## Goal

Limit the right-pane maximize entry point to the Agent files pane and keep the maximized pane as a full-height overlay above conversation content. The composer remains visually above the overlay without reducing the overlay's outer height, while file content reserves an internal safe area so it is not obscured.

## Existing behavior

- `Shell.TabList` always renders a maximize/minimize control, regardless of the active right-pane type.
- `Shell.MaximizedOverlay` currently subtracts the measured composer inset from its content height, so the composer occupies layout space instead of floating above a full-height pane.
- The existing `codex/maximized-pane-safe-area` change moves this inset into a CSS custom property consumed by file-pane scroll regions and framed previews.
- `status`, `trace`, and tool-flow panes change only through explicit user actions. A resource pane can also open from an explicit locate request. No automatic non-file tab transition needs to be added or changed for this task.

## Design

### Consumer-controlled maximize entry

Add a narrow boolean capability to `Shell.TabList` indicating whether the current consumer may enter maximized mode. The shared shell must not infer this capability from the business tab value `files`.

- `AgentRightPaneSurface` enables the entry only when `shellState.activeTab === 'files'`.
- `TopicRightPaneSurface` does not enable it, so branch, trace, and resource panes have no maximize entry.
- Agent resource, status, trace, and tool-flow panes have no maximize entry.
- If the shell is already maximized, retain the minimize control even if an exceptional programmatic transition changes the active tab. This prevents an overlay state with no direct restore action without introducing automatic tab or maximize-state changes.

### Full-height overlay and composer safe area

Keep `Shell.MaximizedOverlay` at full height. When a composer inset is measured, expose it as `--chat-maximized-pane-safe-bottom` on the overlay content rather than setting a shorter inline height.

The Agent files pane consumes the property at the concrete scroll/layout boundaries:

- File-tree scroll region receives bottom padding equal to the safe area.
- Scrollable text/Markdown preview content receives bottom padding equal to the safe area.
- Framed previews (HTML, PDF, Office, image) reduce their internal preview viewport height by the header height and safe-area value.
- Agent status receives no new safe-area behavior because it cannot enter maximized mode through the UI.

The composer keeps its existing elevated stacking behavior and floats above the pane surface.

## Alternatives considered

1. Hard-code `activeTab === 'files'` inside `Shell.TabList`. This is smaller but couples a generic shared component to an Agent-specific tab identifier.
2. Move the maximize control into `AgentRightPane`. This avoids a shared prop but duplicates shell state, sub-window chrome, and maximize/minimize control behavior.
3. Automatically minimize on every non-file tab transition. Current transitions are user-driven, and this adds behavior beyond the request.

The consumer-controlled capability is preferred because it keeps state ownership explicit and the shared API narrow.

## Tests

Use test-driven development and observe each new assertion fail before production changes:

- `Shell.TabList` shows maximize only when the consumer enables it and preserves minimize while already maximized.
- Agent files pane exposes maximize; status, trace, resource, and tool-flow panes do not.
- Maximized overlay remains full height and exposes the measured safe-area CSS property.
- File-tree, scrollable preview, and framed preview layouts consume the safe-area property.

Run only the directly relevant Vitest files, as requested:

- `src/renderer/components/chat/panes/Shell/__tests__/Shell.test.tsx`
- `src/renderer/components/chat/panes/__tests__/ArtifactPane.test.tsx`
- `src/renderer/pages/agents/__tests__/AgentChatArtifactPane.test.tsx`
- Add a Topic right-pane test only if implementation changes require it.

Do not run the full `pnpm test` suite. Because `pnpm build:check` invokes the full test suite, do not run it either. Run applicable lint, type, formatting, i18n, and documentation checks separately and report the omitted full-suite validation.

## Non-goals

- No new automatic tab switching or automatic minimize behavior.
- No changes to right-pane open/close shortcuts.
- No changes to composer stacking or appearance beyond preserving its existing elevated overlay behavior.
- No unrelated refactor of the shared pane shell or artifact preview implementation.
