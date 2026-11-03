# Agent Note: Saving a conversation selection to Notes

Status: implemented

English | [中文](2026-11-03-selection-to-notes.zh.md)

## Problem

The conversation selection toolbar and context menu offered Copy and Quote. Keeping a useful passage in Notes required copying it and creating a note manually, or exporting the complete message.

## Decision

Both selection surfaces offer Save to Notes. The action captures the selected text before asynchronous work, derives a title from its first nonblank line (up to 50 characters), and delegates to the existing `exportContentToNotes` service with the configured Notes path. The exporter retains directory validation, filename collision handling, error feedback and the explicit Open note success action described in [Opening an exported note](2026-10-27-open-exported-note.md).

Selection extraction reuses the quote path: rendered formulas retain Markdown math delimiters and code-viewer line numbers are excluded. This is a text excerpt, not reconstruction of the original Markdown or a persistent link to the source message. The context action requires both selection endpoints inside its message surface and outside editable controls. The floating toolbar retains its existing selection and editable-surface boundaries.

Only one Notes write can be pending per selection-menu instance. Another save is disabled until it settles; a failed write permits retry. Saving does not alter the message or navigate automatically. The exporter is loaded on demand rather than added to the selection surface's eager dependency graph.

## Alternatives considered

- Exporting the complete message keeps unrelated content instead of the chosen passage.
- Appending to a daily collection requires additional destination and append-conflict policy; each invocation creates a normal note instead.
- Adding a source-message link or converting arbitrary selected HTML back to Markdown expands the existing extraction contract.

## Consequences

No new preference, IPC route, persistent format, dependency or model request is needed. Existing translated Save to Notes labels and shared UI controls cover both entries. The source message remains unchanged after a failed write, and the existing exporter owns the single write-error notification.

## Verification

- Regression — `src/renderer/components/__tests__/SelectionNotes.test.tsx`: real toolbar and Cherry/native context-menu gestures save only the captured passage, retain math delimiters, suppress duplicate pending writes, allow retry after failure and exclude editable or out-of-surface selections; the real exporter provides its shared success action.
- Regression — `src/renderer/components/__tests__/SelectionContextMenu.links.test.tsx`: selected links retain their copy, quote and URL actions alongside Save to Notes.
- Regression — existing selection, math, toolbar and `ExportService.test.ts` suites protect extraction, dismissal, collision-path navigation and failure feedback.

Renderer coverage uses jsdom and synthetic Notes writes. It does not establish packaged Electron or native filesystem acceptance for this entry.
