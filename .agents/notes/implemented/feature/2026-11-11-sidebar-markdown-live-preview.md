# Agent Note: Editable Markdown live preview in the right pane

Status: implemented

English | [中文](2026-11-11-sidebar-markdown-live-preview.zh.md)

## Problem

The right pane used `StaticMarkdown` for reading and a separate source editor for changes. Reusing Composer directly would lose tables, images, formulas and Mermaid while bringing chat tokens and send behavior into file editing.

## Decision

Share the source-line schema, Markdown session, syntax decorations and editing keys under `components/markdownLivePreview`. Composer retains its existing adapter. The document surface uses one complete `AppMarkdown` render and portals inactive top-level blocks into ProseMirror widgets, preserving reference definitions and footnotes. Selecting a region reveals its source; leaving it restores rich rendering. Links, images and rendered controls retain their actions.

Keep original source as the editing authority, including frontmatter, carriage returns, trailing spaces and literal template text. Rendering masks frontmatter without modifying source. Composition delays publication of transient text. Unchanged preview widgets retain their DOM when earlier source offsets shift.

Writable right-pane Markdown uses the existing file-edit session in both live-preview and source modes. Automatic saving, manual save, conflicts, retries and leave guards remain session responsibilities. Generic `FilePreview` stays read-only. Both surfaces share `MarkdownFileHostProvider` for image resolution and file navigation, and use existing Markdown styling and design tokens.

## Alternatives considered

- Reuse Composer directly: loses rich rendering and adds chat-specific behavior.
- Implement rich content only in the right pane: duplicates the shared rendering responsibility.
- Serialize a rich-text document back to Markdown: rewrites unrelated source formatting.

## Consequences

Full-document parsing/rendering preserves document context but is not virtualized. In a development Electron run, editing a 56,780-character, 200-section fixture took 183–377 ms per key through two animation frames, versus 29–34 ms in the existing source editor (10 samples each). These include automation and development-build overhead, not production benchmarks. Source mode remains available for large documents; incremental rich rendering is a future performance improvement.

Widget wrappers must preserve normal margin collapse and first/last/adjacent-block spacing. Shared rich-text styles exclude the document surface so editor rules do not override preview typography. File persistence and security policies do not move into the editor.

## Verification

- AC1 — `ArtifactPane.test.tsx` exercises one draft across modes and manual persistence; an Electron-mounted production pane/session wrote a real file with automatic save, retained an unsaved draft across source/preview switches and saved it with Cmd+S.
- AC2 — `MarkdownLivePreview.test.tsx` covers real tables, formulas, reference links, image definitions and footnotes; Electron fixtures exercise local relative images, lists/tasks, formulas and Mermaid through the shared renderer. Source mode remains available for malformed content.
- AC3 — Side-by-side Electron fixtures compare `StaticMarkdown` and live-preview geometry, font sizes and colors at 320/600 px in light/dark themes, including rich content and horizontal overflow.
- AC4 — Shared source/key tests cover editing semantics; continuous Electron interactions exercise entry/blur, undo/redo, cross-region replacement and CDP Chinese composition without publishing intermediate text. Rendering-only component tests assert no draft publication.
- AC5 — `documentSource.test.ts` preserves BOM, CRLF, frontmatter, literal variables and trailing whitespace through an unrelated edit; the read-only component test and existing `ArtifactPane.test.tsx` / `FileEditSessionManager.test.ts` cover permission, failure, conflict and leave protection.
- AC6 — Focused Composer surface, cold-input, input-adapter, suggestion, placeholder and existing live-preview/key tests pass; Markdown file-preview and registry suites retain generic preview routing and image/link behavior. Renderer typecheck and scoped lint checks validate moved consumers.
