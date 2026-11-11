# Agent Note: Editable Markdown live preview in the right pane

Status: proposed

English | [中文](2026-11-11-sidebar-markdown-live-preview.zh.md)

## Problem

The right pane renders Markdown with `StaticMarkdown` and uses a separate source editor for changes. Users want to edit the rendered document directly and save through the existing file session, while retaining the current preview's typography and rich content.

The [Composer live-preview Spec](2026-11-08-composer-markdown-live-preview.md) deliberately leaves tables, images, formulas and task checkboxes as source. Its inline and line decorations alone cannot replace the file preview without losing rendered content. This proposal extends shared live-preview capability for document editing; it does not silently change the Composer's existing rendering contract.

## Proposal

### Shared editing and rendering

Extract the source-preserving live-preview editor core from Composer-specific behavior into a shared renderer component. Composer remains an adapter for its tokens, suggestions and send behavior. The document surface has no send action or token interpretation: literal `${name}` and other source text stay literal.

Keep Markdown source as the editing authority. Reuse the existing Markdown renderers and shared styles for inactive content, including tables, images, inline and block math, Mermaid, lists and task checkboxes. Do not introduce a second HTML sanitizer, diagram renderer or math renderer. Rendering must retain document context for reference links, image definitions and footnotes, rather than parse disconnected fragments that lose their definitions.

Entering an editable region reveals its source without changing the document. Leaving it restores the rendered view. Pointer and keyboard entry must place the caret in the corresponding source region; entering a rendered block starts at that block's source. Selection across regions, undo/redo, paste and IME composition must operate on source, without rebuilding the editor or committing transient composition text. Rendered controls and links keep their existing actions; only editing gestures reveal source. Rendering failures leave the source accessible for correction.

### Right-pane integration

Writable Markdown files open in live-preview editing in the right pane. Retain access to the existing source editor through the pane's mode control. Both views share one `useFileEditSession` draft and save lifecycle; switching views does not reload from disk or lose unsaved changes. Reuse automatic saving, manual save, conflict handling, failed-save recovery and leave guards. Rendering itself never writes to disk or marks the session dirty.

Read-only files remain non-editable. The generic `FilePreview` host stays a read-only API for its other callers. Non-Markdown file behavior is unchanged. Relative images remain relative to the document, file navigation retains the host's workspace resolution, and external links retain current safety rules. Frontmatter may remain visually hidden as today, but stays in the source and can be edited in source mode. Preserve the existing file session's encoding and line-ending behavior without a Markdown parse/serialize round trip.

### Visual contract

Use the current right-pane preview as the baseline: the same content width, outer padding, font family, font sizes, heading hierarchy, paragraph and list spacing, code palette, table borders, image sizing, formula layout and Mermaid styling. Use shared tokens in light and dark themes. Long tables and code scroll within the pane without widening it. Revealed source is an intentional editing state; surrounding rendered content must retain its styling. Any necessary style changes belong to the shared owner, not a second side-pane stylesheet that drifts from it.

### Delivery

First implement the shared editor and rendering contract, then integrate the file session and pane controls. Keep this note proposed until all acceptance criteria have evidence. Implementation begins only after approval of the current Spec head.

## Alternatives considered

- Replace `StaticMarkdown` with the current Composer surface: rejected because it drops rich rendering and brings chat-specific behavior into file editing.
- Add rich rendering only inside the right pane: rejected because the shared live-preview limitation would remain and rendering behavior would diverge.
- Convert Markdown to a rich-text document and serialize it on save: rejected because opening or editing unrelated text could rewrite source formatting and frontmatter.

## Acceptance criteria

- AC1 — A writable Markdown file opens as an editable live preview; edits survive switching to source mode and back, manual save, and reopening the file. Automatic save follows the existing preference. (verification: renderer and Electron)
- AC2 — Tables, relative and reference images, inline and block formulas, Mermaid, lists, task checkboxes, reference links and footnotes retain the current preview's rendered meaning; malformed content stays accessible for correction. (verification: renderer and Electron)
- AC3 — At narrow and wide pane widths in both themes, matching fixtures preserve the baseline typography, padding, colors and rich-content layout, with no pane-wide horizontal overflow. (verification: Electron)
- AC4 — Caret entry and exit, cross-region selection, keyboard navigation, paste, undo/redo and Chinese IME editing preserve the source and commit only intended edits; simply viewing a document never dirties or saves it. (verification: renderer and Electron)
- AC5 — Frontmatter, literal template-like text and unchanged source formatting survive edits; read-only files cannot be changed, and save failure, external conflicts and file switches retain existing recovery and unsaved-change protection. (verification: renderer and Electron)
- AC6 — Existing Composer token, suggestion, send, code-editing and live-preview behavior remains intact; other file-preview callers retain their read-only behavior and existing image/link safety policies. (verification: renderer)

## Risks

Rendering widgets can move content under the pointer or interrupt IME. The shared core must retain composition and pointer protections, and validate continuous interactions rather than isolated renders. Large documents can regress through full-document rendering on every keystroke; compare editing latency and long tasks against the existing source editor on the same representative large file before handoff, and report measured limits.

Existing rich renderers require host context and asynchronous resources. Their mounts, pending work and callbacks must be disposed with the editor, and stale renders must not overwrite a newer draft. The file session remains the sole owner of persistence and conflict decisions.
