# Agent Note: Remove the test-only ArtifactPane wrapper

Status: proposed

English | [中文](2026-10-31-artifact-pane-test-only-wrapper.zh.md)

## Problem

`ArtifactPane.tsx` has a default export that no production code imports. Its only importer is `ArtifactPane.test.tsx`, which renders it at 36 sites. Production renders `ArtifactPaneView` directly from `AgentRightPane` with `headerVariant="pane"` and no `maximized`.

The wrapper is a second state owner. It keeps four controlled-or-internal state pairs, its own workspace reset, and its own stale-selection cleanup. `AgentRightPane` implements the same behavior separately (`workspaceKey` reset and the `isSelectableFileNode` check). This has two costs:

- Those 36 test sites render the real `ArtifactPaneView`, but the reset and cleanup code they exercise is code users never run, so they can pass while that production behavior breaks.
- `ArtifactPaneView` keeps a branch for an overlay header that production never shows, plus `maximized` styling that production never sets.

## Proposal

Delete the default export and `ArtifactPaneProps`. Make the pane header the only `ArtifactPaneView` shape: remove `headerVariant`, the overlay branches for `searchToolbar`, the header, and `renderOverlay`, and the `maximized` prop and its styling.

Move the tests in one pass. A behavior that production owns is tested at its production owner: `AgentRightPane.test.tsx` for workspace reset and stale selection, and `ArtifactPaneView` for rendering. A small harness in the test file supplies the model and selection state so pane tests stay short. A test that only pins the deleted overlay header or the wrapper's own state is removed, and the PR lists each one.

This fits in one PR with no stack, because nothing else depends on the removed code.

## Alternatives considered

- Keep the wrapper as a test fixture: rejected. It preserves the second state owner and leaves the tests away from production behavior.
- Move the wrapper into a test helper unchanged: rejected for the same reason, although it would be the cheapest change.
- Have `AgentRightPane` adopt the wrapper: rejected. It would need the shared state, session, and file navigation that `AgentRightPane` owns, so state would move the wrong way.

## Acceptance criteria

- AC1 — `ArtifactPane.tsx` has no default export or `ArtifactPaneProps`, and `ArtifactPaneView` has no `headerVariant` or `maximized` prop. (verification: unit)
- AC2 — Workspace reset and stale-selection cleanup are tested through `AgentRightPane`, and each test fails when that production behavior is removed. (verification: renderer)
- AC3 — Every removed test is listed in the PR with the production test that replaces it or the reason it only covered deleted code. (verification: renderer)
- AC4 — In the agent right pane, file tree, preview, edit, conflict handling, tabs, and search behave as before. (verification: Electron)

## Risks

- Some wrapper tests may be the only coverage of a production behavior. AC3 exists so that coverage moves instead of disappearing.
- The file-edit Specs in `proposed/architecture` name `ArtifactPane` as a consumer. An in-flight implementation of them may touch the same file, so check open PRs before starting.
