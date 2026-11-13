# Agent Note: Rich editor user command delivery

Status: implemented

English | [中文](2026-11-03-rich-editor-user-command-delivery.zh.md)

## Problem

When a nonempty note's editor is unfocused, a toolbar formatting command can change the document before focus arrives. The focus guard discarded that update, leaving the draft stale and the disk without the heading marker, or saving an older draft. This also affects later blocks, not only the first.

## Decision

The user command entry point marks the same transaction as the formatting operation. The editor hook consumes that intent and delivers document changes even before focus arrives. It still requires an editable editor and a changed document; unmarked transactions retain the focus filter.

This complements [Notes session isolation and silent snapshot loading](2026-10-22-notes-session-isolation.md), which owns session identity and snapshot delivery.

## Alternatives considered

- Marking only H1 and H2 leaves equivalent formatting commands without the same delivery contract.
- Removing the focus filter also admits unmarked programmatic updates, including possible initialization math migration changes.

## Consequences

`setMarkdown` remains a silent snapshot load. Image and formula placeholders, link editing popovers, table action menus, and asynchronous image paste use other entry points and are not covered by this decision. Commands that only change stored marks without changing the document do not deliver body content.

## Verification

- Regression — `src/renderer/components/RichEditor/__tests__/userCommandDelivery.test.tsx`: toolbar headings are delivered as Markdown from unfocused and focused editors; removing an unfocused heading delivers `hello`; unmarked commands and snapshot loads retain their prior behavior.
- Regression — `src/renderer/components/RichEditor/__tests__/userCommandDelivery.test.tsx`, `RichEditor.test.tsx`, `useRichEditor.test.ts`, `toolbarFocus.test.tsx`, and `nativeMarkdown.test.ts`: 66 tests passed in the recorded unit test run.
- Regression — local macOS Electron probe on current main: before the fix, clicking Heading 1 in an unfocused nonempty note produced `<h1>hello</h1>` in the DOM but disk still contained `hello` after 3 seconds (`diskHasMarker: false`); after the fix, the same probe found `# hello\n\n` on disk (`diskHasMarker: true`).
- Regression — `tests/e2e/smoke/noteHeadingFormattingPersistence.test.ts`: on the unfixed baseline `origin/main` at `9164851568673aae54fa6bdd9c4561f9abd62119` with only this spec added, `expect.poll` timed out after 15 seconds with `Expected "# hello" / Received "hello"`; on the fixed tree, the same spec passed in 8.1 seconds for unfocused `Heading.md` and focused `HeadingFocused.md`.

This is not on-site verification of Windows 2.1.2, and the user's exact “type first, then click H1” path was not reproduced.
