# Agent Note: Remove the test-only ArtifactPane wrapper

Status: implemented

English | [中文](2026-10-31-artifact-pane-test-only-wrapper.zh.md)

## Problem

`ArtifactPane.tsx` had a default export that no production code imported. Its only importer was `ArtifactPane.test.tsx`, which rendered it at 36 sites. Production rendered `ArtifactPaneView` directly from `AgentRightPane` with `headerVariant="pane"` and no `maximized`.

The wrapper was a second state owner. It kept four controlled-or-internal state pairs, its own workspace reset, and its own stale-selection cleanup, while `AgentRightPane` implemented the same behavior separately. Those test sites could pass while that production behavior broke. `ArtifactPaneView` also kept an overlay header branch and `maximized` styling that production never reached.

## Decision

`ArtifactPane.tsx` exports only `ArtifactPaneView` and its path and size helpers. The pane header is the only shape: `paneTitle`, `paneActions`, `fileTabs`, and `onPreviewClose` are required, file search is always on, and `headerVariant`, `maximized`, `enableFileSearch`, the overlay close button, the overlay title and dirty dot, and `FileTree`'s `searchToolbar` prop are gone. An open file is always titled by the tab and the breadcrumb.

`AgentRightPane` is the only owner of workspace reset and stale-selection cleanup, and `AgentRightPane.test.tsx` tests both. `useArtifactFileTreeModel` owns what makes a selection stale, so the watcher-removal and search-preservation tests assert the model directly. `ArtifactPaneView` rendering tests share one `ArtifactPaneHarness` in `ArtifactPane.test.tsx`, which supplies the tree model, selection, tabs, and close handler in the shape `AgentRightPane` passes them and adds no reset or cleanup of its own.

## Alternatives considered

- Keep the wrapper as a test fixture: rejected. It preserves the second state owner and leaves the tests away from production behavior.
- Move the wrapper into a test helper unchanged: rejected for the same reason, although it would be the cheapest change.
- Have `AgentRightPane` adopt the wrapper: rejected. It would need the shared state, session, and file navigation that `AgentRightPane` owns, so state would move the wrong way.

## Consequences

Users see no change. `ArtifactPane.tsx` is about 220 lines shorter and `ArtifactPaneView` has one header shape. `ArtifactPane.test.tsx` no longer proves that a pane closes a removed file: that outcome spans the model tests and the `AgentRightPane` cleanup test, which mocks the model.

## Verification

- AC1 — `git grep -n headerVariant -- src` returns nothing, and a typecheck scoped to the eight changed files passes: the default export, `ArtifactPaneProps`, `headerVariant`, and `maximized` are gone.
- AC2 — `pnpm test:renderer src/renderer/pages/agents/components/AgentRightPane/__tests__/AgentRightPane.test.tsx`: `clears open files, edit mode, and tree filters when the workspace $changed changes` and `clears the overlay preview when the selected file disappears from the tree model` pass, and each failed when one of the six reset statements or the cleanup effect was removed.
- AC3 — The implementation PR lists all eight removed or replaced tests with their replacement or the reason they only covered deleted code.
- AC4 — Electron development build driven over CDP: file tree, preview, edit toggle, autosave, conflict reload and keep-draft, tab switching and closing, Escape, search, removal of an open file, split and unpinned layouts, and workspace switching all behaved as specified, with no renderer reload during the runs.
