# Agent Note: Composer Markdown live preview

Status: proposed

English | [中文](2026-11-08-composer-markdown-live-preview.zh.md)

## Problem

People write Markdown in the Composer, but it behaves like a textarea. `**bold**` stays literal, and a fenced code block is only lines of text: Enter sends the message, Tab moves focus, `/` and `@` open panels, and `${name}` turns into a prompt-variable chip. The target is the Obsidian/Typora model, where formatting appears while typing, syntax is visible only where the caret is, and a code block edits like code.

The Composer cannot simply swap editors. Its Tiptap document carries atomic token nodes, QuickPanel, input history, and paste handling read plain text and offsets from it, and `{ text, tokens[textOffset] }` is the draft contract behind message snapshots, draft caches, and cross-window handoff in 18 source files.

A throwaway prototype answered the riskiest questions in headless Chromium: caret movement across hidden markers, simulated IME stability, and byte-identical drafts. It was then accepted as an interaction model after hands-on use in the development app. Its measurements appear below; it is not the implementation.

## Proposal

### 1. First-version scope

| Area | Included |
| --- | --- |
| Inline | Bold, italic, strikethrough, inline code, links |
| Blocks | Headings, block quotes, fenced code, horizontal rules |
| Editing | Bold and italic shortcuts and backtick inline code on a selection, bracket pairing inside fenced code |

Out of scope:

- Tables, images, and task checkboxes stay literal source.
- LaTeX formulas, including `$...$` and `$$` blocks, get no rendering and stay literal source.
- Bullet and ordered lists get no live rendering. Their markers stay visible as source with only a muted color and a hanging indent, and the newline shortcut inserts a plain line instead of continuing the list.
- Code blocks get no language-aware indentation, and the indent unit stays two spaces.
- Selection formatting covers bold, italic, and inline code only.
- Indented code (four leading spaces) is not a code block here. Those lines stay ordinary text.
- The `renderInputMessageAsMarkdown` message-bubble setting is unchanged, and no preference for turning live preview off is added.

### 2. Document and draft contract

The document stays plain text plus token atoms. No Markdown marks or block nodes enter the schema; Markdown exists only as decorations, so `serializeComposerDocument` output is byte-identical with and without live preview.

Each source line becomes its own paragraph, because ProseMirror wraps inline decorations per child node and a continuous code region needs node decorations on whole lines. The draft and marker builders in `composerDraft.ts` and `composerTokenMarkers.ts` emit paragraphs directly, and the newline shortcut splits the block. A `<br>` from HTML the Composer did not build folds into a paragraph boundary outside composition.

`serializeComposerDocument` and the QuickPanel offset helpers already join blocks with `\n`, so `text` and `textOffset` keep their meaning and no persisted data changes. This line model applies to every Composer surface; only rendering is opt-in. The placeholder shows only when the whole Composer is empty, since paragraphs would otherwise show it on every empty line the caret visits.

### 3. Parsing and rendering

- **Parser.** `@lezer/markdown` with its GFM extension, held per editor and reparsed incrementally through `TreeFragment`. It exposes marker nodes directly (`EmphasisMark`, `CodeMark`, `ListMark`, `QuoteMark`) and already ships through CodeMirror, so it becomes a direct dependency. On one 40,000-character corpus in Node, a remark full parse took 48.85 ms, a Lezer full parse 2.66 ms, and a Lezer incremental edit 0.24 ms.
- **Decorations.** Only changed lines and lines whose reveal state changes are rebuilt. The prototype rebuilt everything and spent 21 ms on one caret move at 40,000 characters.
- **Reveal.** Inline markers appear while the selection touches their span, heading, quote, and horizontal-rule markers while it touches their line, and code fences while it touches their block. List bullets stay visible.
- **Hidden markers** use `font-size: 0`. With `display: none`, Chromium normalizes the caret past the hidden run, and the left arrow jumped up to 14 positions in the prototype.
- **Horizontal rules.** A thematic break draws a divider while its marker is hidden. `---` directly under a text line stays a Setext heading underline. Like `===`, the underline's line collapses unless the selection touches the heading text or the underline.
- **Composition.** During IME composition decorations are only mapped; they recompute after `compositionend` settles.
- **Pointer.** Reveal state freezes while the mouse button is held, because expanding markers under the pointer moved a jittered click onto the wrong character.

### 4. Code blocks

Code-block behavior applies only to fenced blocks (Lezer `FencedCode`), never to indented code (`CodeBlock`). A fenced block renders as one continuous full-width region, including blank lines, styled like message code blocks, with its language label in the corner. Highlighting reuses `codeHighlightService.highlightRange` and the `--code-syntax-*` palette from `useCodeStyle`, so colors and language loading match message code blocks and parsing stays off the main thread. Results apply as non-history decorations and are skipped during composition.

Keys inside a fenced block, including its fence lines:

| Key | Behavior |
| --- | --- |
| Any Enter combination | Inserts a newline. It never sends or steers, whatever the shortcut settings are |
| Enter on a code line | Keeps the indentation and adds one level after `{`, `[`, or `(` |
| Enter between an adjacent `{}`, `[]`, or `()` | Moves the closing bracket to a third line at the original indentation and puts the caret on the middle line, one level deeper |
| Enter at the end of an unterminated opening fence at the document end | Adds the closing fence and puts the caret on the empty line between |
| Enter on the closing fence | Opens a new line below and leaves the block |
| Tab / Shift+Tab | Indents or outdents all selected lines by two spaces |

Outside a fenced block, Enter and Tab keep the existing shortcut settings and routing.

On code lines, typing `(`, `[`, `{`, `"`, or `'` adds its closer and leaves the caret between them when the caret is at the line end or before whitespace, `)`, `]`, `}`, `:`, `;`, or `,`. A quote directly after a word character is not paired. Typing an auto-inserted closer steps over it, Backspace inside an empty auto-inserted pair removes both, and typing one of these characters with a selection wraps the selection. An auto-inserted closer is forgotten once the caret leaves its line. Backticks are not paired, so a fence typed by hand stays exact.

Code stays literal. Inside a fenced block QuickPanel does not trigger, pasted text inserts as plain text without prompt-variable, link, skill, or knowledge tokens, and typed `${name}` stays text. Document-level checks read the parsed code ranges. Text-level paths (a pasted fenced block, drop, file text, panel insertion, draft restore) all reach `createComposerTokenMarkerInlineContent`, which skips matches inside fenced code on live-preview surfaces. Inline code spans keep today's tokenization.

### 5. Selection formatting

On a live-preview surface Cmd/Ctrl+B and Cmd/Ctrl+I toggle bold and italic by editing the source. The style is read from the parsed Markdown, so `**` and `*` combine independently and a literal asterisk in the text does not count. Each selected line is handled on its own, skipping blank lines, fenced code, block prefixes such as `# ` or `- `, and whitespace at the selection's edges; a selection edge inside a span's markers counts as the edge of its text. If the selected text on every line already has the style, the key removes the style from just that text, splitting a longer span around it. Otherwise lines without the style gain it, merging any span of the same style that the selection touches or overlaps, so making `这是` bold in `这是**重点**` gives `**这是重点**` rather than two marker runs side by side. The selection stays on the text. An empty selection, or one wholly inside fenced code, leaves the key to its existing meaning, so Cmd/Ctrl+I still focuses the Composer. When the Composer does act, it consumes the key before the app-wide shortcut handler.

Typing a backtick with a selection outside fenced code toggles inline code under the same per-line rules. The added delimiters are one backtick longer than any backtick run inside the code, with a space inside them when the code starts or ends with a backtick. With an empty selection, inside fenced code, or during composition the backtick is ordinary input.

### 6. Reusable core and adoption

`createComposerEditorPreset` gains a `markdownLivePreview` option and `ComposerSurface` passes it through.

| Surface | Live preview |
| --- | --- |
| `ChatComposer`, `AgentComposer`, `MissingAgentHomeComposer`, `SelectionAgentComposeBar` | On |
| `PaintingComposer`, `WebviewAnnotationControls` | Off, because image prompts and page annotations are not Markdown documents |

The core exposes `isMarkdownFencedCodePosition(state, position)`. Chat and Agent keep tokens, QuickPanel, and steer in their own layers and consume only that query and the option.

```text
src/renderer/components/composer/markdownLivePreview/
├── markdownSession.ts      incremental parse and source/document position map
├── livePreviewPlugin.ts    decorations, reveal, composition and pointer freeze
├── codeBlockPlugin.ts      code regions and worker highlighting
├── codeBlockKeys.ts        Enter and Tab inside code blocks
├── codeBlockPairs.ts       bracket pairing inside code blocks
└── selectionFormatKeys.ts  bold, italic, and inline code on a selection
```

Styles join the `.composer-tiptap` rules in `richtext.css` and use design tokens. The prototype's debug panel and `.prototype` module are not carried over.

### 7. Delivery

| Layer | Content | Covers |
| --- | --- | --- |
| 1 | Paragraph-per-line model and placeholder | AC1, AC6, AC7, AC14 |
| 2 | Parser, decorations, surface opt-in | AC2, AC3, AC4, AC5, AC15, AC16, AC17, AC18, AC19, AC21 |
| 3 | Code regions, highlighting, code keys, bracket pairing | AC8, AC9, AC10, AC11, AC20, AC22, AC23 |
| 4 | Literal code across token and QuickPanel paths | AC12, AC13 |
| 5 | Selection formatting | AC24, AC25 |

## Alternatives considered

- Milkdown/Crepe: rejected. Milkdown 7.23 escaped 14 of 19 ordinary sample strings on round trip (`2 * 3 * 4` became `2 \* 3 \* 4`, `Array<string>` became `Array\<string>`), Crepe adds a Vue 3 runtime, and no syntax-reveal capability was found.
- Markdown nodes and marks in the Tiptap schema (Notion style): rejected as the first approach because serialization would need a Markdown writer and could no longer guarantee byte-identical drafts. It remains the fallback if decorations fail under a real IME.
- Replacing Tiptap with a CodeMirror 6 live preview: rejected without prototyping, because token node views, QuickPanel, paste, and offset handling all bind to the Tiptap document.
- Embedding CodeMirror in each code block: rejected for the first version. It would provide full code editing, but code would have to become a separate node, against the source-line model, and caret entry and exit, undo, and IME would all need new verification.
- One paragraph with hard breaks, the current model: rejected because decorations cannot form one continuous code region across hard breaks.
- remark with a full reparse: rejected because parsing alone took 48.85 ms of the prototype's roughly 57 ms keystroke at 40,000 characters.
- Letting configured shortcuts send from inside a code block: rejected. A fixed rule means a half-written snippet cannot be sent by accident, whichever key a user has bound.
- Applying code-block behavior to indented code too: rejected. A pasted indented log would silently lose Enter-to-send, QuickPanel, and tokens, and it has no closing fence to leave by.

## Acceptance criteria

- AC1 — On a live-preview surface, the serialized `text` and token `textOffset` values for any draft, including escape-prone input such as `2 * 3 * 4` and `Array<string>`, are byte-identical to the same editing sequence with live preview off. (verification: renderer)
- AC2 — Bold, italic, strikethrough, inline code, links, headings, and block quotes render styled, with their syntax markers hidden when the selection does not touch them, while bullet and ordered list markers stay visible as source. (verification: renderer)
- AC3 — Moving the selection into a styled span, heading, or quote reveals its markers and moving out hides them, and the left and right arrow keys step through the same positions as an undecorated document. (verification: Electron)
- AC4 — A mouse click lands on the character under the pointer with no marker reveal until release, and a mouse drag selects the expected source range across hidden markers. (verification: Electron)
- AC5 — With a real macOS Chinese input method, composing at the start, middle, and end of styled spans and inside highlighted code commits exactly once without breaking composition. (verification: Electron)
- AC6 — The newline shortcut, undo and redo, Backspace at a line start, Delete at a line end, multi-line paste, and input-history navigation produce the same serialized text as before the line-model change. (verification: renderer)
- AC7 — With the caret outside a code block, Enter combinations follow the configured send, newline, and steer shortcuts exactly as before. (verification: renderer)
- AC8 — A fenced block renders as one continuous full-width region including blank lines, shows its language label, and reveals its fences only while the selection is inside the block. (verification: Electron)
- AC9 — Code highlighting uses the message code-block worker and palette, and its colors follow a code-theme switch without reloading the draft. (verification: Electron)
- AC10 — Inside a code block every Enter combination inserts a newline and never sends or steers; a new line keeps indentation and adds one level after an opening bracket, an unterminated opening fence at the document end gains a closing fence, and Enter on the closing fence moves to a new line below the block. (verification: renderer)
- AC11 — Inside a code block Tab and Shift+Tab indent and outdent by two spaces across all selected lines without moving focus, while Tab outside a code block keeps its current behavior. (verification: renderer)
- AC12 — On a live-preview surface `${name}` inside a fenced block stays literal for typing, paste, drop, file text, panel insertion, and draft restore, including when the fenced block arrives as one piece, and still becomes a token outside fenced blocks. (verification: renderer)
- AC13 — With the caret inside a code block, `/` and `@` do not open QuickPanel, and pasted URLs, skill markers, and knowledge-base markers stay plain text. (verification: renderer)
- AC14 — The placeholder appears only when the whole Composer is empty, on the first line, and reappears after the Composer is cleared. (verification: renderer)
- AC15 — Token atoms keep their rendering, selection, and deletion behavior inside styled spans and headings, and round-trip at their original `textOffset`. (verification: renderer)
- AC16 — Chat, Agent, and the selection agent compose bar show live preview, while the painting prompt and webview annotation input stay plain. (verification: renderer)
- AC17 — Copy and cut export the selected source text including its hidden markers, with tokens preserved. (verification: renderer)
- AC18 — In a production build on the reference MacBook Pro M5, measured in the same session against the same draft without live preview, live preview adds at most 33 ms to the median longest main-thread task per keystroke or caret move, on a 40,000-character draft of long paragraphs (about 340 lines) and on a worst-case 40,000-character draft of short formatted lines (about 2,400 lines). (verification: production build)
- AC19 — Tables, images, and LaTeX formulas stay literal source with no dedicated rendering and are sent verbatim. (verification: renderer)
- AC20 — Lines that are code only by four-space indentation render as ordinary text with no code region, Enter follows the configured shortcuts, and QuickPanel triggers and `${name}` tokenization work as on any other line. (verification: renderer)
- AC21 — A thematic break (`---`, `***`, or `___`) draws a divider while the selection is off its line and shows its source while the selection is on it, `---` or `===` directly under a text line makes a heading whose underline line collapses while the selection is outside the heading and shows while the selection touches it, and the text is sent verbatim. (verification: renderer)
- AC22 — On code lines, typing `(`, `[`, `{`, `"`, or `'` adds its closer under the follow-character and word rules, typing an auto-inserted closer steps over it, Backspace in an empty auto-inserted pair removes both, a selection is wrapped, backticks and fence lines are unaffected, and nothing pairs outside fenced code or during composition. (verification: renderer)
- AC23 — Enter between an adjacent `{}`, `[]`, or `()` on a code line moves the closing bracket to a third line at the original indentation and leaves the caret on the middle line one level deeper. (verification: renderer)
- AC24 — With a selection outside fenced code, Cmd/Ctrl+B and Cmd/Ctrl+I remove bold or italic from the selected text on each line when all of it already has the style, splitting a longer span, and otherwise add the style, merging with spans of the same style that the selection touches or overlaps; bold and italic combine independently, block prefixes and edge whitespace stay outside the markers, the selection stays on the text, and an empty selection keeps the key's existing behavior. (verification: renderer)
- AC25 — With a selection outside fenced code, typing a backtick toggles inline code on each selected line under the same rules as AC24, with delimiters longer than any backtick run inside the code, and an empty selection, a selection wholly inside fenced code, and composition insert the character normally. (verification: renderer)

## Risks

- Real macOS IME and mouse drag were not verified by automation; the prototype only simulated composition in headless Chromium. AC4 and AC5 gate the work, and the schema-based model is the fallback.
- LaTeX is not parsed, so `*` inside formulas such as `$2*3*4$`, `\frac{a*b}{c*d}`, and `$$` blocks is read as emphasis and its markers hide until the caret arrives. The sent text is unaffected. This is accepted until formula support exists.
- The Composer's parser differs from the message renderer's, so edge-case Markdown can preview differently from the sent message. The source text is never altered.
- When a code block ends the message, sending takes the send button or leaving the block first, and leaving it adds a trailing newline to the draft.
- Hidden markers stay in the accessibility tree and in selections, so screen readers read them. This follows from keeping the source text intact.
- Revealing markers shifts text on the caret's line. This is inherent to the model.
- The line model changes every Composer surface, and existing tests pin the hard-break document shape. AC1 and AC6 guard the behavior.
- Hand-written code keys stop at indentation. If that proves too limited, embedding CodeMirror is the path to revisit.
- Preview cost grows faster than the line count. On the reference machine it adds about 1 ms per keystroke at 338 lines and about 25 ms at 2,366 short formatted lines, so a slower machine with thousands of pasted lines can feel it. Lower-end hardware is unmeasured, and AC18 is relative because the Composer without preview already takes about 17 ms on the worst-case draft.
