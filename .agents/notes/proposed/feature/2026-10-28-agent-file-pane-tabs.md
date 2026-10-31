# Agent Note: Agent file pane tabs and breadcrumb

Status: proposed

English | [中文](2026-10-28-agent-file-pane-tabs.zh.md)

## Problem

The Agent file pane opens a file as a full-pane overlay that hides the tree. The header turns into a "secondary page" with a back arrow, so moving between files means going back and forth. Following a link inside a file, such as a Markdown reference, replaces the current file. The return path lives in a hidden back chain that the user cannot see.

The tree also wraps the workspace in a synthetic root row, and file names sit one indentation step deeper than sibling folder names.

## Proposal

The layout follows the ChatGPT file pane.

### Layout

- **Wide pane (at least 672px):** the tree sits on the left, 256px wide by default, and the open file fills the right column. A handle on the tree's right edge resizes it between 180px and 480px; the width is kept in the renderer persist cache (`ui.agent.file_pane.tree_width`) and applies to every workspace. The tree stays visible and highlights the active file. With no file open, the right column shows an "Open a file" empty state.
- **Pinning the tree (wide pane):** a toggle at the left of the header pins or unpins the tree. Unpinned, the tree is hidden: an open file fills the pane, and with no file open the pane shows the empty state. The choice is remembered per workspace in the renderer persist cache (`ui.agent.file_pane.unpinned_tree_workspaces`, the unpinned workspace paths), and a workspace is pinned by default.
- **Narrow pane:** the open file covers the tree as it does today. A tree toggle at the left of the header shows and hides the tree without closing tabs, and replaces the back arrow.

### Header: file tabs

- The pane header is a tab strip. Each tab shows the file name, an unsaved dot, and a close button, and the active tab is highlighted. Only the pane actions (maximize, close) sit on the right; there is no refresh or workspace open button.
- **Opening a file** from the tree, the breadcrumb, or a link inside a file (a Markdown reference, for example): opens it in a new tab right after the active one. If the file is already open in a tab, that tab becomes active instead. The active tab title is italic. Tabs shrink toward a readable minimum (about ten characters) as they fill the header. Tabs that still do not fit move into a ▾ menu at the end of the strip, which lists only those hidden tabs; the strip itself does not scroll. The active tab always stays in the strip, taking the last visible slot when needed.
- **Close:** the neighbouring tab becomes active. Closing the last tab shows the empty state.
- **Switching tabs:** works like selecting that file in the tree. The existing edit session saves drafts in the background when a file is detached, so switching tabs never loses edits.
- **State:** tabs are owned by the Agent right pane, belong to one Agent session, are cleared when the workspace changes, and are not persisted across restarts.

### Breadcrumb row

- Above the file, the right column shows the file's workspace-relative path as a breadcrumb. Files outside the workspace show only their name.
- Every segment opens a dropdown: a folder segment shows that folder's entries, and the file segment shows the entries of its own folder. The dropdown is a small file tree: folders expand in place, as in the pane's tree, with their own expanded state, so the pane's tree does not change. Choosing a file opens it like a tree click (a new tab, or its existing tab) and closes the dropdown.
- The right end of this row holds, in order: the preview plugin's toolbar (only attachment previews have one, e.g. their Markdown/HTML Preview/Source toggle, rendered here through the file-preview toolbar portal), the quote-selection picker for documents that support it, the Edit/Preview toggle for rendered text files, and the **Open** split button, which lists every open target. There is no ⋯ button (removed by the user on 2026-10-29), since the Open button and the right-click menu already cover its items. There is no separate copy button.
- The tabs, the breadcrumb, and the tree share one right-click menu layout (following ChatGPT): **Attach as context**, **Copy ▸**, then the open targets. Attach as context adds the file or folder to this session's composer, the same chip and attachment an `@`-mention of the path creates; a file already attached is not added twice. Copy ▸ holds file content (the open file only, when it can be copied as text), absolute path, workspace-relative path (inside the workspace only), and file name. The open targets are **Open in ‹default app›** and **Reveal in Finder** (File Explorer / file manager on other platforms), with other apps under **Open with ▸**; the open file's targets come from the same cached lookup as the Open button.
- Each breadcrumb segment has its own menu: the file segment shows the file menu, and a folder segment shows that folder's tree menu, so Attach as context attaches the folder. The tree omits File Content because it does not know whether a row's file is copyable text.
- A tab's menu adds **Close file**, **Close other files** (with more than one tab), and **Close all files**. With autosave off, closing away a file with unsaved edits asks first, as switching tabs does. Find in file and Reload file from the ChatGPT menu are left out: the editor's own ⌘F covers find, and reload was removed with refresh (see below). Reveal in file tree was dropped by the user on 2026-10-29.
- The breadcrumb menu has no close item, since tabs and Escape already close the file, and no menu has a refresh item (removed by the user on 2026-10-29). The tree follows file watchers; an open preview or editor does not yet reload when the file changes outside the pane.

### Editing

- There is no preview/edit toggle. A plain-text file (one the text preview plugin would render, or one with no matching plugin) opens directly in the live editor and saves automatically.
- A file with a rendered preview (HTML, Markdown, images including SVG, video, PDF, Word, PowerPoint, spreadsheets) opens in its preview. When it is also text (Markdown, HTML, SVG) and not read-only, a single Edit/Preview toggle directly left of the Open button switches it to the same live editor on its source and back. Binary formats such as PNG, PDF, and Office files have no toggle.
- A plain-text file the editor cannot load (binary content or over the size limit) falls back to its preview without an error toast.

### Pane settings

A ⋯ menu in the pane header, next to the pane actions, holds settings that apply to every workspace. They are Preferences (`feature.agent.file_pane.*`):

| Setting | Key | Default | Effect |
|---|---|---|---|
| File tree position | `tree_position` | `left` | `left` or `right`; moves the tree column in a wide pane. A narrow pane is unaffected. |
| Autosave | `auto_save` | on | Off: edits are no longer saved while typing. While the file has unsaved edits, **Cancel** (discard) and **Save** buttons appear at the right of the breadcrumb row, and ⌘S / Ctrl+S saves. Switching to another file or closing its tab asks *Discard unsaved changes?* with **Keep editing** and **Discard**. Other exits (switching agent session, closing the pane) still save, so edits are never lost silently. |
| Tab to indent | `tab_indent` | on | Off: Tab moves focus instead of indenting. |
| Word wrap | `word_wrap` | on | Wraps long lines in the editor. A file with a line over 256 KB (minified bundles, source maps) is never wrapped, and the option is greyed out with the reason while it is open: wrapping one such line froze the window for 0.6–5 s in testing, against under 0.5 s unwrapped. |
| Indent guides | `indent_guides` | on | Draws a guide at every indentation stop of a line's leading whitespace. |
| Show whitespace | `show_whitespace` | off | Marks spaces and tabs inside whitespace runs. |
| Scroll past end | `scroll_past_end` | off | Lets the last line scroll to the top of the editor. |
| Tab size | `tab_size` | 2 | 2, 4, or 8 columns. |

Indent guides and whitespace marks come from a local `@pierre/diffs` patch on its four line builders (`utils/renderTokenLines.js` and `worker/worker.js` for highlighted views, `renderers/FileRenderer.js` for lines re-rendered while editing, and `editor/tokenizer.js` for the line being typed). Whitespace-only token spans get `data-ws`, and leading ones also `data-indent`; in the two editing paths a token that starts with indentation is split into a whitespace span and a text span with matching `data-char` offsets. The pane draws both marks as CSS backgrounds, so text and caret positions are unchanged. Blank lines carry no guide, and whitespace inside a non-whitespace token (for example inside a string) is not marked.

### Tree rows

- The synthetic workspace root row is not shown, so top-level entries start at depth 0.
- Folders show only a chevron, and file icons take the chevron column, so sibling names align. This applies only to this pane through a `FileTree` option, and Notes and Skills keep their folder icons.
- `CLAUDE.md` uses the Claude file icon.
- The selected row, the active tab, and the pressed tree toggle share `--resource-list-row-selected`. It no longer aliases the 5% `--accent`; it is its own token at 8% black (light) and 14% white (dark). `--resource-list-row-hover` and the inactive-tab hover reuse it instead of the 2% `--background-subtle`, which was invisible. Every resource list using these tokens gets the stronger fills.

### Navigation history

Links between files no longer use the hidden return chain, because the originating file stays open in its own tab. Attachment previews opened from the composer keep their existing return behavior.

## Alternatives considered

- **Keep the full-pane overlay at every width:** rejected. The tree disappears whenever a file is open.
- **Put the breadcrumb in the pane header and drop the file header:** tried on 2026-10-28 and rejected by the user. It overwrote the file header and needed an ad-hoc close button.
- **Tree clicks replace the active tab, and only links open new tabs:** used first, then reversed by the user on 2026-10-29. Every file now opens in its own tab.
- **A preview/edit toggle for every editable file:** rejected by the user on 2026-10-29. Plain text opens straight in the editor; only rendered text formats, which have a preview worth keeping, get the toggle.
- **Switch the layout with CSS container queries only:** rejected. The header content depends on the mode, and CSS cannot change which elements render.

## Acceptance criteria

- AC1 — In a pane at least 672px wide, opening a file keeps the tree visible on the left and highlights the active file; with no file open the right column shows the empty state. (verification: Electron; owner: pane implementer)
- AC2 — In a narrower pane the file covers the tree, and the header's tree toggle shows the tree again without closing any tab. (verification: renderer and Electron; owner: pane implementer)
- AC3 — Opening a file from the tree, the breadcrumb, or a link adds a tab right after the active one, or activates the file's existing tab. (verification: renderer; owner: pane implementer)
- AC4 — Closing the active tab activates its neighbour, and closing the last tab shows the empty state. (verification: renderer; owner: pane implementer)
- AC5 — Switching tabs while a file has unsaved edits keeps those edits on disk or in the draft, and the tab shows an unsaved dot while edits are pending. (verification: renderer and Electron; owner: edit-session owner)
- AC6 — The breadcrumb shows the workspace-relative path; each segment, including the file, opens a dropdown of entries, folders expand in place without changing the pane's tree, and a chosen file opens in a new tab or activates its existing tab. (verification: renderer and Electron; owner: pane implementer)
- AC7 — The tree shows no workspace root row, sibling folder and file names align in this pane only, and `CLAUDE.md` shows the Claude icon. (verification: renderer and Electron; owner: pane implementer)
- AC8 — Attachment previews opened from the composer return to their previous target as before. (verification: renderer; owner: pane implementer)
- AC9 — In a wide pane the header toggle pins or unpins the tree; the choice applies to that workspace only and survives a reload. (verification: renderer and Electron; owner: pane implementer)
- AC10 — A plain-text file opens in the live editor with no toggle; Markdown, HTML, and SVG files open in their preview with an Edit/Preview toggle left of the Open button; PNG files open in their preview with no toggle. (verification: renderer and Electron; owner: pane implementer)
- AC11 — Each pane setting changes the editor or layout as described, applies to every workspace, and survives a restart; with autosave off, Save/Cancel appear only while edits are pending and leaving the file asks before discarding. (verification: renderer and Electron; owner: pane implementer)
- AC12 — Attach as context from a tab, the breadcrumb, or the tree adds that file or folder to the session composer once; a folder breadcrumb segment attaches the folder; Close other files and Close all files leave one or no tabs. (verification: renderer and Electron; owner: pane implementer)

## Risks

- The right pane already keeps tool-flow tabs (`flowTabState`); file tabs need their own state and must not share it.
- Tabs keep file selections alive. A tab whose file is deleted or renamed must show the existing missing-file state rather than crash.
- A pane width near 672px can flip between layouts while the pane is resized; the switch must not reset tabs or drafts.
