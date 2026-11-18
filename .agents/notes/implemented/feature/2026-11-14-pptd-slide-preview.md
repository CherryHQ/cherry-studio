# Agent Note: PPTD slide preview

Status: implemented

English | [中文](2026-11-14-pptd-slide-preview.zh.md)

## Problem

Issue #20452 asks for a visual preview of PPTD projects in the file preview panel. Today a `.pptd` manifest has no plugin in `src/renderer/components/FilePreview/filePreviewRegistry.ts`, so `FilePreview.tsx` falls back to the text preview and shows YAML source. Agents that produce PPTD decks (`presentation.pptd` plus `pages/*.page` and `media/`) therefore cannot review slides in the same workspace where they revise them.

The format is defined by the open-kimi-ppt-skill reference `skills/open-kimi-ppt/reference/pptd.md` (PPTD v2, YAML 1.2, px units, 1px = 1pt). This Spec treats that document as the format source and does not claim the format is owned by Cherry Studio.

## Decision

- A `pptd` file preview plugin is registered for the `pptd` extension, following the `powerpoint` plugin shape in `packages/file-preview/src/plugins/powerpoint/powerPointFilePreviewPlugin.ts`. The plugin lives beside the powerpoint plugin and is wired through the same registry.
- The manifest is the entry point. The plugin reads `version`, `title`, `size`, `theme` and `pages` from the manifest, then resolves each `pages[]` path and each relative media path relative to the manifest directory through the existing file access path. Media `Image.src` and background/fill `ImageFill.src` also accept HTTPS URLs under the upstream reference; these remain URL sources, are not resolved as local paths, and load as remote HTTPS media. Failed remote loads use the same visible placeholder fallback as missing local media. It does not scan the directory for unlisted `.page` files.
- Each page renders as a fixed-size canvas at `size`, scaled to the pane. The element types the issue names (text with rich-text tags and theme styles, image, shape, line, icon) plus table and chart each have one renderer, and styles resolve in the priority order the upstream reference defines.
- Math formulas use KaTeX, already a repository dependency (`package.json`). Formula text is extracted from the text element content; no second math engine was added.
- Page navigation (previous, next, page number), zoom, and a manual refresh button are provided. The source/preview toggle keeps the existing text preview as the source view, and thumbnails are included under the full-issue scope.
- Unsupported element types, unknown style references, and missing media render a visible placeholder with the element id and reason. Nothing is silently dropped.
- The plugin is read-only: it does not write `.pptd`, `.page`, or media files, and it does not export PPTX.

## Alternatives considered

- Reuse the powerpoint plugin for PPTD: that plugin renders OOXML binaries, and PPTD is YAML with a different data model, so the rendering path would not be shared.
- Generate a PPTX with an external converter and show it through the powerpoint plugin: this adds an export step and a stale-preview problem, and the issue explicitly does not require PPTX export.
- Render only the manifest's `pages` list and leave charts and tables to a later Spec: this keeps the first version small, but it would fail the full-issue scope chosen by the requester. Kept as a fallback if chart rendering proves disproportionate during implementation.
- Embed an external PPTD viewer in a webview: the issue lists this as an alternative, but it would not keep the preview inside the file preview panel or support refresh after agent edits.

## Consequences

- The upstream reference is a third-party document. Its field names and defaults are used as-is; if it changes, the plugin follows the pinned revision recorded in this PR.
- Charts and tables are the largest parts of the upstream spec and dominated the implementation. The AC4 placeholder fallback means unsupported types degrade visibly instead of failing the deck.
- Resolving relative `pages` and `media` paths depends on the project directory access path. Paths that escape the project directory are rejected, not followed, which the media tests cover.
- Manual Electron verification (AC6) was not run in this environment; the preview renders in the browser test harness but the in-app Electron check remains open for review.

## Verification

- AC1 — Opening a `.pptd` manifest in the file preview panel shows rendered slides in `pages` order at the manifest `size`, not YAML source. Evidence: `loadPptdProject` unit tests parse the manifest, keep `pages` order and mark missing pages without failing the deck; the canvas renders at the manifest `size`, and the registry test resolves `.pptd` to the pptd plugin instead of the YAML text fallback. All 644 `packages/file-preview` tests pass.
- AC2 — Text, image, shape, line and icon elements render at their `bounds` with theme and inline style precedence matching the upstream reference, including rich-text `<u>`, `<sup>`, `<strong>` tags. Evidence: The 30 plugin tests in `packages/file-preview/src/plugins/pptd/__tests__/pptd.test.ts` cover the text style chain (defaults < theme text style < content fields), rich-text tag handling, shape paths honoring adjustments, line bezier paths, image crop/fit math, icon name parsing and table style chains; text, image, shape, line, icon, table and chart elements each render at their `bounds` through the canvas.
- AC3 — Formula text in text elements renders through KaTeX, and invalid formula input shows the source text with an error marker instead of throwing. Evidence: `splitPptdMathSegments` and `renderPptdRichText` tests assert `\(...\)` formulas route through KaTeX and that invalid input shows the source text with an error marker instead of throwing.
- AC4 — Table and chart elements render, and any element type not yet supported renders a visible placeholder that names the element id and type. Evidence: Table tests cover merged-region placement and the category style chain; `buildPptdChartOption` tests cover bar, line, area and pie mapping and assert unsupported types (sankey) return null so the canvas shows the named placeholder.
- AC5 — Missing `pages` files, missing local media, or failed HTTPS media loads render a visible placeholder that names the missing path, and the rest of the deck still renders. Evidence: `loadPptdProject` marks missing pages with their path; unreadable media surfaces an error state in `usePptdMediaUrl` and the image renderer shows the `image_unavailable` placeholder naming the element and `src`.
- AC6 — Page navigation, zoom, thumbnails, and the manual refresh button work, and refresh picks up changes the agent made to the manifest, `.page`, or media files. Evidence: Navigation, zoom, thumbnails and manual refresh are implemented in `PptdFilePreview`; refresh bumps the reload nonce so the manifest, `.page` files and media are re-read through `readProjectFile`. Manual Electron verification was not run in this environment and is called out in the PR.
- AC7 — Source/preview toggle returns the existing YAML text view, and the plugin never writes project files. Evidence: The source toggle reads the manifest bytes fresh through `document.readRange` and shows them in a read-only view; the plugin exposes no write path for project files.
- AC8 — A registry test resolves `.pptd` to the new plugin, and `.pptx` still resolves to the powerpoint plugin. Evidence: The registry test asserts `.pptd` resolves to the pptd plugin and `.pptx` still resolves to the powerpoint plugin.
