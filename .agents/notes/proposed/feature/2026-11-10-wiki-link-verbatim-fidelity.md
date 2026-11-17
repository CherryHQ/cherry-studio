# Agent Note: Wiki-link verbatim fidelity in rich-text notes

Status: proposed

English | [中文](2026-11-10-wiki-link-verbatim-fidelity.zh.md)

## Problem

Notes store Markdown, and `[[target|alias]]` is the Obsidian link form users write by hand. Cherry's rich-text editor parses that text, so every save round-trips it through `@tiptap/markdown`'s `MarkdownManager`. That round trip currently rewrites the token instead of preserving it:

- A plain `[[T]]` is escaped to `\[\[T\]\]` on save, so Obsidian no longer recognises the link.
- `**[[T]]**` saves as `[[T]]`, and `*a [[T]] b*` saves as `*a* *[[T]]* *b*` — the surrounding marks are lost or split. The parse side never attaches a mark to a leaf node because `applyMarkToContent` only visits nodes with children (`node_modules/@tiptap/markdown/src/MarkdownManager.ts:851`).
- Text extraction drops the link entirely: `editor.getText()`, `doc.textBetween()` and the default plain-text clipboard all return `before  after` for `before [[T|Alias]] after`.
- An HTML round trip loses the token because the node renders no raw attribute, and the manager's HTML fallback hands the whole inline run to `generateHTML` (`patches/@tiptap__markdown@3.26.1.patch:150`), leaving `<span data-wiki-link>` in the saved text.
- The custom tokenizer swallows ordinary text around brackets, so `[**重要**] [[T]]` becomes one non-editable atom and an unclosed `[` eats the rest of the line.

A user who keeps an Obsidian vault therefore cannot edit notes in Cherry without corrupting links and formatting.

## Proposal

Rich-text notes preserve a wiki link byte-for-byte across load and save, keep the marks around it, and expose it to text extraction and the clipboard. Editing the link, resolving its target and navigating remain separate concerns.

### Responsibility split

- `@tiptap/markdown`'s `MarkdownManager` owns verbatim emission and mark boundaries for inline nodes. Cherry keeps extending it through the existing `patches/@tiptap__markdown@3.26.1.patch`, which patches `dist/index.js`, `dist/index.cjs` and `src/MarkdownManager.ts`; the three artifacts must stay identical and `pnpm-lock.yaml` carries the regenerated patch hash.
- The renderer's wiki-link extension owns how the node presents itself: `renderText`, the schema's `leafText`, the HTML attributes and their parser.
- The Notes domain owns target resolution only.

### Contract

| Requirement | Acceptance |
|---|---|
| Unedited token is preserved verbatim | Aliases, spaces, CJK, `&`, backslashes, table-escaped pipes and directory-qualified targets all save unchanged, and the HTML fallback never turns the link into an attribute-only span |
| Marks around the link survive | `**[[T]]**`, `*a [[T]] b*`, nested marks and a mark applied from the toolbar all round-trip |
| Text extraction keeps the link | `getText`, `textBetween`, selection export and both clipboard flavours contain the token |
| The tokenizer never swallows ordinary Markdown | `[**重要**] [[T]]`, an unclosed outer bracket, ordinary links, code spans and escaped literals keep their text |
| Raw, display and navigation stay consistent | After a partial edit, undo and redo, the saved token matches the displayed target |
| Navigation needs a unique target | A missing, ambiguous or unsupported target does not navigate |

## Alternatives considered

- **Un-escaping tokens before save.** A bare `[[T]]` and a deliberately escaped `\[\[T\]\]` are indistinguishable after parsing, so a string rewrite would silently convert literal text into links.
- **Read-only navigation only.** It keeps edits from corrupting files but does not deliver save fidelity, and the tokenizer defects remain.
- **Changing the node to `text*`.** The text child still goes through the escaping path, marks still split at the node boundary, and it introduces a second source of truth between the child text and the stored raw token.
- **Re-implementing mark boundaries in the renderer.** That duplicates `MarkdownManager`'s logic per custom node instead of fixing it once for every inline node.

## Acceptance criteria

- AC1 — Loading and saving a note whose text contains `[[T]]`, `[[dir/T.md|Alias]]`, or an alias with spaces, CJK, `&` or a backslash leaves the token byte-identical on disk. (verification: renderer unit tests; owner: rich-text editor owner)
- AC2 — `**[[T]]**` round-trips as `**[[T]]**` and `*a [[T]] b*` as `*a [[T]] b*`; a bold applied to the link from the toolbar serialises as `**[[T]]**`. (verification: renderer unit tests; owner: rich-text editor owner)
- AC3 — `editor.getText()`, `doc.textBetween()`, selection export and both clipboard flavours contain the full token for `before [[T|Alias]] after`. (verification: renderer unit tests; owner: rich-text editor owner)
- AC4 — An HTML round trip, including pasting Cherry's own HTML, restores the exact raw token rather than an empty node. (verification: renderer unit tests; owner: rich-text editor owner)
- AC5 — `[**重要**] [[T]]` keeps its bold text editable and its link navigable, and an unclosed `[` does not consume the rest of the line. (verification: renderer unit tests; owner: rich-text editor owner)
- AC6 — A target written with a different extension case resolves to the real file, and a missing, ambiguous or unsupported target does not navigate. (verification: renderer unit tests and Electron smoke; owner: notes domain owner)
- AC7 — Editing an unrelated paragraph and saving leaves the file equal to the baseline plus that edit. (verification: Electron smoke; owner: rich-text editor owner)

## Risks

- The patch is a growing divergence from upstream. Every `@tiptap` upgrade has to be checked against the parse, mark-boundary and HTML-fallback paths it touches, and a silent behaviour change there is only caught by this feature's tests.
- The lockfile patch hash changes with every patch edit. A stale hash fails the install in CI, which is loud, but it also means the patch cannot be tweaked outside a full install cycle.
- The verbatim channel is opt-in per node type, yet it changes shared mark-boundary code. Other editors that use `MarkdownManager` could observe different output for their own inline nodes, so the regression suites stay part of the gate.
- HTML fallback can still be the only lossless path for some mixed inline runs; where it triggers, the token survives in Cherry but Obsidian sees a span, not a link.
- Cursor movement, shift-selection, backspace/delete, CJK IME and undo/redo across the atom boundary are not covered by automation yet, so their behaviour is unverified until the manual matrix is run.

## Verification

- Unit: the extension's markdown round-trip cases for the contract table above, the resolver's case handling, and the tokenizer's boundary cases.
- Regression: `nativeMarkdown.test.ts` and `markdownBold.test.ts` stay green, because the patch has to keep ordinary text and marks byte-identical.
- Electron smoke: navigate from a link, edit an unrelated paragraph and confirm the saved file equals the baseline plus that edit; ambiguous targets do not navigate.
- Manual, still outstanding: cursor movement across the node boundary, shift-selection, backspace/delete, CJK IME, undo/redo, both clipboard flavours, switching between read, source and rich-text modes, and opening the saved file in Obsidian itself.
