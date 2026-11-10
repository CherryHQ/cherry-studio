# Agent Note: Horizontal tabs for consecutive chat code blocks

Status: proposed

English | [中文](2026-10-31-consecutive-code-block-tabs.zh.md)

## Problem

Chat renders consecutive code blocks vertically, so readers must scroll between related snippets. The existing code-block views already own highlighting, editing, copying, saving, execution, and special previews. A tab group should compose these views without introducing a second code editor or changing message content.

`ChatMarkdownRuntime` supplies chat renderers to `AppMarkdown`. Streaming Markdown splits the source before running Markdown plugins, so grouping only within an individual parsed fragment cannot group consecutive top-level fences reliably. The streaming partition and Markdown grouping must agree.

This is a new composition decision alongside [code-block viewing and editing](../architecture/2026-10-26-message-code-block-surfaces.md); it does not replace that note's editor, highlighting, or state ownership.

## Proposal

### Scope and grouping

- Enable grouping in chat message Markdown, including consumers of the shared chat message renderer. Other Markdown hosts, including translation and file preview, retain their existing presentation.
- Group a maximal run of at least two sibling fenced code blocks. Whitespace between fences does not interrupt a run. Prose, headings, images, tables, raw HTML, indented code, and other nodes interrupt it. Never group across messages, message blocks, or distinct list/blockquote containers.
- Preserve the existing special rendering of fenced HTML and diagram languages inside their panels. Fences that the chat renderer classifies as file/navigation links remain standalone and interrupt a run; inline code is never eligible.
- A single code block keeps its current appearance. Grouping is presentation only: persisted Markdown and exported Markdown retain every original block in source order.

### Component and interaction

- Add a reusable renderer `CodeBlockTabs` component composed from `Tabs`, `TabsList`, `TabsTrigger`, and `TabsContent` in `@cherrystudio/ui`. It accepts stable item identities, labels, and rendered content; it has no message actions or file-navigation knowledge.
- Use a horizontal underline tab strip above the active code block. Labels use the fence language; repeated languages receive an ordinal, and missing languages use a localized code-block label with an ordinal. Do not introduce filename metadata syntax in this change.
- Select the first tab initially. Clicking or using the existing Tabs keyboard interaction switches the visible panel. The strip scrolls horizontally in narrow containers, keeps the focused tab reachable, and uses the existing light/dark semantic tokens and visible focus styles.
- Preserve each visited block's unsaved draft, editor history, view mode, and local controls when switching away and back. Mount panels when first visited and retain visited panels while the group exists; hidden panels must not remain keyboard-focusable. Existing copy/save/run actions continue to target their own block's displayed source.
- Streamed content updates its corresponding panel. Adding another fence never steals the selected tab or resets existing panels; completing the stream also preserves selection. A changed message content identity resets the group, and a removed selected item falls back to the first remaining item.

### Integration and verification

Keep Markdown structure recognition in the unified pipeline. Preserve source positions and original fence bodies, and extend the existing streaming partition seam so a consecutive run reaches the grouping pass together. Chat owns eligibility and rendering overrides; shared Markdown accepts only the smallest hook required for chat to compose its block parser. Do not add a global preference, persist tab selection, duplicate code-block state, or replace the Markdown engine.

Implement the Spec as one dependent implementation layer after approval. First verify grouping and streaming partition contracts with explicit parser test files, then verify tab interactions and affected chat consumers with explicit renderer test files. Finally exercise real chat messages in Electron, including an edited draft, streaming append, special previews, keyboard navigation, and a narrow container in both themes. Use the existing code-block Electron scenario as the integration starting point.

## Alternatives considered

- Group React siblings or inspect the rendered DOM: streaming fragments separate siblings before this point, and DOM rearrangement bypasses React ownership and source positions.
- Split Markdown with a regular expression: nested containers, alternate fence delimiters, and unfinished fences require Markdown syntax awareness already provided by the parser.
- Reuse one code-block view for every selected tab: changing its source resets or mixes per-block editor state and actions.
- Enable grouping in every Markdown host: expands the requested chat scope and changes file preview and translation without a demonstrated need.

## Acceptance criteria

- AC1 — Two or more consecutive eligible fences render as one tab group in source order; single fences, inline code, file/navigation links, interrupted runs, and separate containers preserve their boundaries. (verification: parser and renderer tests; owner: implementation author)
- AC2 — Language labels, duplicate-language ordinals, and localized missing-language labels identify panels; mouse and keyboard can activate every tab, including overflowing tabs, in light and dark themes. (verification: renderer tests and Electron; owner: implementation author)
- AC3 — Switching away and back preserves an unsaved draft and editor undo history, and copy/save/run use the selected block's own displayed source and permissions; existing HTML and diagram previews remain usable when activated. (verification: affected renderer tests and Electron; owner: implementation author)
- AC4 — An unfinished fence, appended fence, and stream completion update the correct panel without changing user selection or losing existing panel state; replacing content identity or removing the selected item resets selection deterministically. (verification: streaming parser and renderer tests, plus Electron streaming scenario; owner: implementation author)
- AC5 — Other Markdown hosts and persisted/exported Markdown remain unchanged; grouped blocks retain their original source text, order, and message save targets. (verification: affected consumer tests and source audit; owner: implementation author)

## Risks

Grouping increases the size of one streamed render fragment. Keep unrelated Markdown fragments independently renderable and verify that appending content preserves existing panel identities. Retaining visited panels uses more resources than unmounting them; unvisited panels should not start editors or special previews. Hidden diagram and editor surfaces may need their existing visibility/measurement behavior exercised when reactivated. Image and rich-content capture must be inspected for hidden-panel behavior during implementation; this proposal does not add an export mode or discard source blocks.
