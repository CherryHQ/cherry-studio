# Agent Note: File link line navigation

Status: implemented

English | [中文](2026-11-18-file-link-line-navigation.zh.md)

## Problem

Chat file references can contain source locations, but `ClickableFilePath` removes colon-suffixed line and column numbers and Markdown file-link parsing drops fragments. File open actions and preview plugins receive a path without a location. A link to line 42 therefore opens the file without revealing that line. Agent file opening also routes HTML into the browser pane before source preview.

## Decision

File references carry a filesystem path and an optional renderer-owned `FileLocation`. Inline paths and local Markdown links accept `path:42`, `path:42:5`, `path#L42`, and `path#L42-L48`. Lines are one-based and ranges inclusive; columns are retained but navigation highlights whole lines. Markdown parses coordinates before percent-decoding so encoded filename punctuation stays literal. Existing URI-scheme safety remains: single-segment colon destinations must use `./file.ts:42`; ordinary fragments keep existing handling.

The same location contract crosses Markdown openers, `ClickableFilePath`, message actions and preview navigation. Only pure paths reach filesystem operations or external applications. External-editor line protocols are not added.

The right-pane owner creates a fresh location per accepted click, including same-file clicks, and stores it with the active selection rather than retained tabs. Existing metadata generations reject obsolete opens, and dirty-edit confirmation still controls acceptance. Plain opens and tab activation clear the location. Located HTML bypasses browser routing; Markdown and HTML show source. Binary previews and surfaces without an in-app preview retain their existing behavior.

`FileEditor` uses Pierre `onPostRender`, `VirtualizedFile.getLinePosition`, `setSelectedLines` and `Virtualizer.scrollTo`. It waits for stable logical coordinates and a visible target before completing navigation. Unmount cancels scheduled work. This accommodates lazy source loading, wrapped rows and virtualized targets without querying off-screen line DOM. Positive out-of-range positions clamp to the loaded document; invalid coordinates create no navigation request.

## Alternatives considered

- Forward raw suffixed strings to file APIs: rejected because metadata and reads need the actual filesystem path.
- Add separate parsers to Markdown and clickable paths: rejected because path decoding, Windows prefixes and line syntax would diverge.
- Find a line element and call `scrollIntoView`: rejected because off-screen virtualized lines may have no DOM node.
- Open all located links in an external editor: rejected because this version targets the existing in-app preview and not editor-specific protocols.

## Consequences

Source positions refer to the current loaded file, not a historical revision quoted in chat. Inline colon-number filenames remain ambiguous; explicit Markdown targets can encode literal punctuation. Source highlighting uses Pierre's existing line selection styling. The public parser and navigation arguments remain optional for path-only callers.

Renderer tests cover routing, stale metadata and dirty-file cancellation. Electron evidence uses real chat Markdown, file-preview plugins, filesystem reads and Pierre in an isolated component harness inside the development app; it is not a packaged-build or complete conversation-session test. The user explicitly authorized implementation of Spec #24746 at `dfc4838e3b3d81ba524a983a5c691f1ea16e27c8` without the normally required GitHub human review.

## Verification

- AC1 — `src/renderer/utils/__tests__/filePath.test.ts` and `src/renderer/components/chat/messages/markdown/plugins/__tests__/rehypeBareFilePaths.test.ts`: 77 tests pass, covering supported coordinates, encoded filenames, URI rejection and POSIX prose scanning.
- AC2 — `ClickableFilePath.test.tsx`, `ChatMarkdown.test.tsx`, `openFileTarget.test.ts` and file-preview consumer suites pass; Electron clicks through real chat Markdown and inline paths reveal and highlight source lines after actual file loading.
- AC3 — `src/renderer/pages/agents/components/AgentRightPane/__tests__/AgentRightPane.test.tsx`: repeated same-file navigation, plain-open clearing, obsolete metadata and dirty-file cancellation pass; Electron repeats the same line link after manually scrolling away.
- AC4 — Markdown/HTML plugin and right-pane routing tests pass; Electron located Markdown and HTML open source at line 42 while existing unlocated routing tests remain green.
- AC5 — Electron on macOS reveals lines 3000–3003 in a 4000-line wrapped file, returns to line 42, clamps line 99999 to line 4000 and clears highlighting on a plain open; the fixture contents remain unchanged.
- AC6 — Scoped renderer tests, `pnpm typecheck:web`, changed-file Oxlint/ESLint and format checks, documentation impact inspection, bilingual pairing and `pnpm docs:check` pass. Existing ESLint warnings are reported; Windows/Linux and packaged runtime checks were not run.
