# Agent Note: Horizontal tabs for consecutive chat code blocks

Status: implemented

English | [中文](2026-10-31-consecutive-code-block-tabs.zh.md)

## Problem

Chat previously rendered consecutive code blocks vertically, requiring readers to scroll between related snippets. The existing code-block views already own highlighting, editing, copying, saving, execution, and special previews. The tab group composes these views without introducing a second code editor or changing message content.

`ChatMarkdownRuntime` supplies chat renderers to `AppMarkdown`. Streaming Markdown splits the source before running Markdown plugins, so grouping only within an individual parsed fragment cannot group consecutive top-level fences reliably. The streaming partition and Markdown grouping must agree.

This is a new composition decision alongside [code-block viewing and editing](../../proposed/architecture/2026-10-26-message-code-block-surfaces.md); it does not replace that note's editor, highlighting, or state ownership.

## Decision

### Scope and grouping

- Grouping is enabled in chat message Markdown, including consumers of the shared chat message renderer. Other Markdown hosts, including translation and file preview, retain their existing presentation.
- A maximal run of at least two sibling fenced code blocks forms a group. Whitespace between fences does not interrupt a run. Prose, headings, images, tables, raw HTML, indented code, and other nodes interrupt it. Never group across messages, message blocks, or distinct list/blockquote containers.
- Fenced HTML and diagram languages preserve their existing special rendering inside panels. Fences that the chat renderer classifies as file/navigation links remain standalone and interrupt a run; inline code is never eligible.
- A single code block keeps its current appearance. Grouping is presentation only: persisted Markdown and exported Markdown retain every original block in source order.

### Component and interaction

- The reusable renderer `CodeBlockTabs` component is composed from `Tabs`, `TabsList`, `TabsTrigger`, and `TabsContent` in `@cherrystudio/ui`. It accepts stable item identities, labels, and rendered content; it has no message actions or file-navigation knowledge.
- A compact horizontal tab strip replaces the code-block header inside one shared frame, using language icons alongside labels and the shared neutral selected-tab surface. The active block's toolbar appears on the right of the header on hover or keyboard focus; the shared `ScrollArea` handles overflow. Labels use the fence language; repeated languages receive an ordinal, and missing languages use a localized code-block label with an ordinal. Do not introduce filename metadata syntax in this change.
- The first tab is initially selected. Clicking or using the existing Tabs keyboard interaction switches the visible panel. The strip scrolls horizontally in narrow containers, keeps the focused tab reachable, and uses the existing light/dark semantic tokens and visible focus styles.
- Each visited block retains its unsaved draft, editor history, view mode, and local controls when switching away and back. Panels mount on first visit and stay mounted while the group exists; hidden panels are excluded from keyboard focus. Existing copy/save/run actions continue to target their own block's displayed source.
- Streamed content updates its corresponding panel. Adding another fence never steals the selected tab or resets existing panels; completing the stream also preserves selection. A changed message content identity resets the group, and a removed selected item falls back to the first remaining item.

### Integration

Keep Markdown structure recognition in the unified pipeline. Preserve source positions and original fence bodies, and extend the existing streaming partition seam so a consecutive run reaches the grouping pass together. Chat owns eligibility and rendering overrides; shared Markdown accepts only the smallest hook required for chat to compose its block parser. Do not add a global preference, persist tab selection, duplicate code-block state, or replace the Markdown engine.

The Remend patch preserves parser-identified code ranges verbatim while completing surrounding prose, including unfinished tilde fences. This source-correctness fix also applies to standalone blocks. The dependency receives `mdast-util-from-markdown` through a package extension; it reuses the unified parser already present in the application.

## Alternatives considered

- Group React siblings or inspect the rendered DOM: streaming fragments separate siblings before this point, and DOM rearrangement bypasses React ownership and source positions.
- Split Markdown with a regular expression: nested containers, alternate fence delimiters, and unfinished fences require Markdown syntax awareness already provided by the parser.
- Reuse one code-block view for every selected tab: changing its source resets or mixes per-block editor state and actions.
- Enable grouping in every Markdown host: expands the requested chat scope and changes file preview and translation without a demonstrated need.

## Consequences

Grouping increases the size of one streamed render fragment. Unrelated Markdown remains independently renderable, and the partitioner caches classification of unchanged fragments. Visited panels retain their editors and previews, using more resources than unmounting them; unvisited panels defer mounting. The active block portals its existing controls into the shared header, so action closures retain their own source and permissions.

Markdown and text exports retain all source blocks. Image capture displays the selected panel; a separately mounted topic capture starts at the first tab. This change does not add an export-specific expansion mode. Remend now parses fenced fragments to protect code, adding parsing work while preserving literal streaming source.

## Verification

- AC1 — `codeBlockTabs.test.ts` and `ChatMarkdownCodeTabs.test.tsx`: grouping respects source order, whitespace, interrupted runs, file links, raw HTML, and nested containers; the affected chat renderer tests pass.
- AC2 — `CodeBlockTabs.test.tsx` and Electron `tests/e2e/ondemand/specs/code-block-tabs.ts`: localized and repeated labels, keyboard activation, overflow at 620 px, light/dark rendering, a single shared header, and toolbar hover visibility pass.
- AC3 — The Electron scenario verifies independent unsaved drafts, undo/redo, active-source copying, persisted saves, Mermaid rendering, and HTML preview. Existing `CodeBlockView.session.test.tsx`, `CodeBlockView.test.tsx`, and explicit CodeToolbar copy/download/run/save tests pass; Python runtime execution itself was not rerun in Electron.
- AC4 — Parser and renderer tests cover unfinished/added fences, completion, source identity changes, and selected-item removal. An Electron probe of the production chat renderer verifies an unfinished tilde fence, appending a CSS tab, and completion without stealing selection; this probe does not exercise a live provider request.
- AC5 — `AppMarkdown.test.tsx`, the affected chat tests, and `streaming-code-source.test.tsx` pass. The Electron save assertion compares the entire persisted Markdown, including other tabs; the export/capture source audit confirms the distinctions described above. Scoped lint, web/E2E type checks, and documentation gates pass.
