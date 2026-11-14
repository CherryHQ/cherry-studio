# Agent Note: Markdown file preview outline

Status: proposed

English | [中文](2026-11-12-markdown-file-outline.zh.md)

## Problem

Issue #22705 requests heading navigation for Markdown documents opened from an agent workspace. The existing PR has no implementation. Current main already owns Markdown file rendering in `src/renderer/components/FilePreview/plugins/markdown/MarkdownFilePreview.tsx`, so the outline belongs to that preview rather than a new parallel document renderer or conversation outline.

## Proposal

- Add a collapsible outline to rendered Markdown file preview, including files opened by an agent from a workspace. Reuse the same preview for manual file opening; do not add an agent-only parser.
- List rendered H1-H3 headings in document order with indentation. Derive IDs and labels from the actual Markdown rendering pipeline; duplicate headings get stable distinct targets and fenced code is not a heading source.
- Clicking or keyboard-activating an entry scrolls the owning preview viewport to its heading. Scrolling updates the current entry. Keep focus behavior explicit and preserve the user's reading position when merely opening or closing the outline.
- Default to collapsed on narrow panes; offer an accessible outline toggle and localized empty state. Do not consume the editable source pane or alter file content. Source/edit mode keeps its existing controls.
- Rebuild entries on file/content changes, disconnect observers on switch/unmount, and scope anchors to each preview instance so two previews of the same file do not target each other.

## Alternatives considered

- Floating jump menu: uses less space but hides document structure; keep as a future alternative if pane-width acceptance fails.
- Reuse the PDF outline component unchanged: its PDF page-navigation contract does not supply Markdown anchors; share presentation only if its ownership remains clear.
- Add a separate Markdown plugin in the shared preview package: duplicates the renderer's existing Markdown preview and file-navigation lifecycle.

## Acceptance criteria

- AC1 — Agent-opened and manually opened Markdown previews show the same H1-H3 order, indentation and labels; code fences and non-heading syntax do not create entries (verification: renderer)
- AC2 — Duplicate, Unicode and formatted headings navigate to distinct correct targets in two simultaneous preview instances (verification: renderer)
- AC3 — Entry activation scrolls the owning viewport; scrolling updates the current entry without moving keyboard focus; toggling preserves reading position (verification: renderer and Electron)
- AC4 — File refresh/switch updates the outline without stale entries or leaked observers; edit/source mode and file saving remain unchanged (verification: renderer)
- AC5 — Narrow/wide layouts, light/dark, keyboard and screen-reader labels are checked in a real app; very long documents remain responsive with observer work bounded to headings (verification: Electron)

## Risks

- Independently parsing heading text can disagree with renderer IDs. The renderer's actual heading output must be the navigation source.
- Observers or global IDs can cross preview instances; explicit viewport ownership and cleanup are required.
- Panel placement and this shared-preview scope are proposed decisions. No implementation or approval is claimed; wait for explicit human approval of this Spec head before implementation.
