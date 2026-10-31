# Agent Note: Comment on files from the Agent file pane

Status: proposed

English | [中文](2026-10-30-file-pane-comments.zh.md)

## Problem

The Agent file pane can quote part of a Word, Excel, PDF or PowerPoint file into the composer: the user turns on the picker, clicks a paragraph, cell range, shape or page, and clicks **Quote selection**. The composer gets a `reference` chip whose prompt text is a fenced `selection-ref` block: the file path, a structural anchor computed by the preview plugin (`packages/file-preview/src/documentAnchor.ts`), an excerpt, and a file stamp. The office-transform skill reads the anchor from that block to locate what to change.

Two gaps remain:

- A quote carries no request. The user writes what they want in the composer and has to describe again which quote it applies to. Leaving several targeted remarks across a file, the way a code review does, has no direct path.
- Text files (source code, plain text, Markdown/HTML/SVG source in Edit mode) cannot be quoted at all. The user copies lines and line numbers by hand.

## Proposal

Scope: the Agent file pane and the Agent composer, which are the only surfaces wired for selection references today. A comment is a message to the agent. Files are never modified, and a comment lives only in the composer draft until it is sent.

### Comment model

- A comment is a location, an excerpt and the user's text, inserted as one composer `reference` chip. Several comments accumulate as several chips and go out in one message with whatever else the user types.
- `SelectionReference` gains an optional `comment` (trimmed, non-empty).
- The chip's description shows the comment, falling back to the excerpt. A chip with a comment shows a comment icon; a document quote without one shows a quote icon, named in the token's persisted `icon` so a sent message keeps it.

### Text files

- The pane's text editor (`FileEditor`, Pierre `File`, editable or read-only) turns on Pierre's gutter utility. Hovering a line shows a comment button beside its line number; clicking it comments that line.
- Dragging across line numbers selects a range (`enableLineSelection`), and the button comments the whole range (`onGutterUtilityClick(range)`).
- The comment box opens inline under the last line of the range through Pierre line annotations (`lineAnnotations` + `renderAnnotation`): a single padded text field on the editor's own background, sized to the visible editor and kept in view while the code scrolls sideways, with a submit button inside it and no line highlight behind it; its placeholder names the shortcut. The button or Cmd/Ctrl+Enter submits; Escape or clicking elsewhere in the window cancels, while switching to another window keeps the draft. Escape returns focus to the file; submitting moves it to the composer, as every chip insertion does. One draft is open at a time.
- While the box is open, edits above it move it with the text: Pierre's editor remaps line annotations on document changes.
- Submitting inserts a chip labelled `name · L19` or `name · L19–21`. Its prompt text is plain Markdown, not a `selection-ref` block: the absolute path, the line range, the commented lines verbatim in a fenced code block (truncated at `SELECTION_EXCERPT_MAX_LENGTH`), and the comment.
  - The office-transform scripts reject anchor formats other than xlsx, docx, pdf and pptx (`office_extract.py`), and a text file must not be routed to that skill.
  - Line numbers are those at submit time. The verbatim lines let the agent find them again if the file changes before the message is sent.
- Rendered previews (Markdown preview, HTML preview) are out of scope; their source is commentable in Edit mode.

### Documents (docx, xlsx, pdf, pptx)

- The picker and the plugins' anchors stay as they are. No renderer changes: every plugin already maps what the user picks to an anchor in the document's own structure.
- **Quote selection** becomes **Comment**. It opens the same comment field at that position, on its own surface because it floats over the document. Submitting with text attaches the comment. Submitting empty quotes the selection exactly as today.
- The chip keeps its `selection-ref` block, with `comment` added at the top level beside `anchor`. The skill passes only `anchor` to its scripts, so they need no change. `SKILL.md` documents the new field.

### Out of scope

- Showing submitted comments on the rendered document. That needs an inverse mapping from each format's anchor back to rendered DOM, which is the part that would require renderer work.
- Writing comments into files: Word comments, Excel notes, PDF annotations.
- The non-agent chat composer, comment threads, and persistence outside the draft.

## Alternatives considered

- **Rewrite the Office and PDF renderers to own comment anchoring:** not needed. The plugins already produce structural anchors; only the comment input is missing.
- **Write comments into the document as native annotations:** a different feature. It modifies user files and needs per-format writers.
- **Keep submitted comments as markers on the file:** deferred. Markers would diverge from the composer once a chip is edited or removed; the composer stays the single place a comment lives.
- **Send text-file comments as `selection-ref` with a new `text` anchor format:** rejected. The skill's scripts reject unknown formats, and the block would invite the agent to route a code file to the Office skill.
- **A floating comment button beside each picked document part:** rejected for now. It needs geometry from every format; the existing fixed action position works for all of them.
- **Status quo (quote, then describe in the composer):** the request loses its location, and text files have no quote at all.

## Acceptance criteria

- AC1 — In the Agent file pane, hovering a line of a text file shows a comment button beside its line number, in editable and read-only text; clicking it opens a comment box under that line. (verification: renderer and Electron; owner: implementer)
- AC2 — Selecting several lines by dragging across their line numbers and clicking the button comments the whole range, with the box under the last line. (verification: renderer and Electron; owner: implementer)
- AC3 — Submitting a text-file comment inserts one composer chip labelled with the file name and line or line range; the sent message contains the absolute path, the range, the commented lines verbatim and the comment, and no `selection-ref` block. (verification: renderer; owner: implementer)
- AC4 — An empty comment cannot be submitted on a text file; Escape or clicking elsewhere in the window closes the box and inserts nothing, and Escape returns focus to the file; switching to another window keeps the draft; Cmd/Ctrl+Enter submits. (verification: renderer; owner: implementer)
- AC5 — While a comment box is open, inserting or deleting lines above it keeps it under the same line content. (verification: renderer; owner: implementer)
- AC6 — For a picked part of a Word, Excel, PDF or PowerPoint file, the pane's quote action opens a comment box; submitting with text inserts a chip whose `selection-ref` block carries the unchanged anchor plus `comment`, and submitting empty inserts the same chip as Quote selection does today. (verification: renderer and Electron; owner: implementer)
- AC7 — The office-transform scripts accept the anchor from a commented `selection-ref` unchanged, and `SKILL.md` documents the `comment` field. (verification: unit and docs gate; owner: implementer)
- AC8 — Comments on one or more files accumulate as separate chips and are all sent in one message. (verification: renderer; owner: implementer)

## Risks

- Pierre exposes the gutter utility on `File`; whether it runs while the editor is attached is unverified. The first implementation step checks it. If it does not, the fix goes upstream or into the existing `@pierre/diffs` patch, flagged for review before any workaround.
- Line numbers go stale if the file changes between submitting and sending. The verbatim lines mitigate this but do not prevent it.
- Long ranges are truncated at the excerpt limit, so the agent may need to read the file for the rest.
- Each comment adds its excerpt to the prompt; many large comments grow the message.
- Existing anchor limits carry over: a PDF comment points at a whole page, and Word headers, footers, footnotes and table cells have no anchor, so they cannot be commented.
- This adds a selection action that the [Pierre code surfaces Spec](../architecture/2026-10-24-pierre-code-surfaces.md) kept out of its migration scope.
