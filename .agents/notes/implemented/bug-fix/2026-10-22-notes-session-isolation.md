# Agent Note: Notes session isolation and silent snapshot loading

Status: implemented

English | [中文](2026-10-22-notes-session-isolation.zh.md)

## Problem

Reopening cached note A after B could render B's draft under A's identity before `useFileEditSession` adopted A's snapshot. Its edit callback wrote through the current model reference, so a callback carrying B's content could edit A. The live `RichEditor.getMarkdown()` getter exposed this without typing: Markdown serialization can turn `__bold__` into `**bold**`, causing the page's string comparison to call `setMarkdown`. That snapshot-loading method emitted a content-change callback and scheduled autosave. A's valid disk version could not detect that its replacement content belonged to B.

## Decision

Expose a ready session and its content only when the adopted model matches the requested file key. Bind `setDraft` to the adopted model instance and reject callbacks after that instance is detached, including when the same path is reopened. Keep the leaving model's existing serialized final-save behavior.

Load rich-editor snapshots with Tiptap's `emitUpdate: false` and no consumer content-change callbacks. Actual edits continue to notify consumers. Keep the live Markdown getter so immediate reads after editor commands remain current.

## Alternatives considered

- Reverting the getter conceals this trigger but restores stale immediate reads and leaves session ownership unsafe.
- An editor key alone remounts with the stale draft supplied by the session.
- Disk version checks protect against external file changes, not content attributed to the wrong session.

## Consequences

Switching files can briefly render loading even when the target snapshot is cached. An old editor callback cannot change a newer session. `setMarkdown` is a silent snapshot-loading API; callers that intend to edit must use editing commands instead. No persistence format or migration changes are needed.

The [file editing lifecycle proposal](../../proposed/architecture/2026-10-22-file-edit-session-lifecycle.md) defines the broader target for async completion, retained sessions, editor modes and close coordination. This note records the bounded overwrite repair; its verification does not establish that proposed lifecycle's acceptance.

## Verification

- Regression — `src/renderer/hooks/__tests__/useFileEditSession.switching.test.tsx`: cached A→B→A never exposes another file's ready draft; detached callbacks cannot write B or a reopened A, while the current callback still saves.
- Regression — `src/renderer/components/RichEditor/__tests__/RichEditor.test.tsx`: loading Markdown with different serialized spelling emits no edit callback; subsequent focused editing still reports content, and immediate reads remain current.
- Regression — local Electron verification: with a 150006-character A and B containing `__BRAVO other note__`, A→B→A previously overwrote A without typing; after the repair, both files and A's modification time remain unchanged, and editing A saves only A. This is local macOS evidence, not packaged or Windows acceptance.
