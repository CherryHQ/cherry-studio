# Agent Note: PPTD slide preview

Status: proposed

English | [中文](2026-11-14-pptd-slide-preview.zh.md)

## Problem

Issue #20452 asks for a visual preview of PPTD projects in the file preview panel. Today a `.pptd` manifest has no plugin in `src/renderer/components/FilePreview/filePreviewRegistry.ts`, so `FilePreview.tsx` falls back to the text preview and shows YAML source. Agents that produce PPTD decks (`presentation.pptd` plus `pages/*.page` and `media/`) therefore cannot review slides in the same workspace where they revise them.

The format is defined by the open-kimi-ppt-skill reference `skills/open-kimi-ppt/reference/pptd.md` (PPTD v2, YAML 1.2, px units, 1px = 1pt). This Spec treats that document as the format source and does not claim the format is owned by Cherry Studio.

## Proposal

- Register a `pptd` file preview plugin for the `pptd` extension, following the `powerpoint` plugin shape in `packages/file-preview/src/plugins/powerpoint/powerPointFilePreviewPlugin.ts`. The plugin lives beside the powerpoint plugin and is wired through the same registry.
- The manifest is the entry point. The plugin reads `version`, `title`, `size`, `theme` and `pages` from the manifest, then resolves each `pages[]` path and each relative media path relative to the manifest directory through the existing file access path. Media `Image.src` and background/fill `ImageFill.src` also accept HTTPS URLs under the upstream reference; these remain URL sources, are not resolved as local paths, and load as remote HTTPS media. Failed remote loads use the same visible placeholder fallback as missing local media. It does not scan the directory for unlisted `.page` files.
- Render each page as a fixed-size canvas at `size`, scaled to the pane. Support the element types that the issue names (text with rich-text tags and theme styles, image, shape, line, icon) plus table and chart as their own cases. Each element type has one renderer, and styles resolve in the priority order defined by the upstream reference.
- Math formulas use KaTeX, which is already a repository dependency (`package.json`). Formula text is extracted from the text element content; this Spec does not add a second math engine.
- Provide page navigation (previous, next, page number), zoom, and a manual refresh button. Source/preview toggle keeps the existing text preview as the source view. Thumbnails are in scope for this Spec under the full-issue scope.
- Unsupported element types, unknown style references, and missing media render a visible placeholder with the element id and reason. Nothing is silently dropped.
- The plugin is read-only. It does not write `.pptd`, `.page`, or media files, and it does not export PPTX.

## Alternatives considered

- Reuse the powerpoint plugin for PPTD: that plugin renders OOXML binaries, and PPTD is YAML with a different data model, so the rendering path would not be shared.
- Generate a PPTX with an external converter and show it through the powerpoint plugin: this adds an export step and a stale-preview problem, and the issue explicitly does not require PPTX export.
- Render only the manifest's `pages` list and leave charts and tables to a later Spec: this keeps the first version small, but it would fail the full-issue scope chosen by the requester. Kept as a fallback if chart rendering proves disproportionate during implementation.
- Embed an external PPTD viewer in a webview: the issue lists this as an alternative, but it would not keep the preview inside the file preview panel or support refresh after agent edits.

## Acceptance criteria

- AC1 — Opening a `.pptd` manifest in the file preview panel shows rendered slides in `pages` order at the manifest `size`, not YAML source (verification: renderer)
- AC2 — Text, image, shape, line and icon elements render at their `bounds` with theme and inline style precedence matching the upstream reference, including rich-text `<u>`, `<sup>`, `<strong>` tags (verification: renderer)
- AC3 — Formula text in text elements renders through KaTeX, and invalid formula input shows the source text with an error marker instead of throwing (verification: renderer)
- AC4 — Table and chart elements render, and any element type not yet supported renders a visible placeholder that names the element id and type (verification: renderer)
- AC5 — Missing `pages` files, missing local media, or failed HTTPS media loads render a visible placeholder that names the missing path, and the rest of the deck still renders (verification: renderer)
- AC6 — Page navigation, zoom, thumbnails, and the manual refresh button work, and refresh picks up changes the agent made to the manifest, `.page`, or media files (verification: Electron)
- AC7 — Source/preview toggle returns the existing YAML text view, and the plugin never writes project files (verification: renderer)
- AC8 — A registry test resolves `.pptd` to the new plugin, and `.pptx` still resolves to the powerpoint plugin (verification: unit)

## Risks

- The upstream reference is a third-party document. Its field names and defaults are used as-is; if it changes, the plugin follows the pinned revision recorded in the implementation PR.
- Full-issue scope includes charts and tables, which are the largest parts of the upstream spec. They may dominate the implementation; AC4 keeps the placeholder fallback so the Spec can ship in layers.
- Resolving relative `pages` and `media` paths depends on the project directory access path. Paths that escape the project directory must be rejected, not followed.
- Placement (new plugin beside powerpoint versus inside the renderer FilePreview tree) and the decision to ship charts and tables in this Spec are proposed decisions. No implementation is claimed; wait for explicit human approval of this Spec head before implementation.
