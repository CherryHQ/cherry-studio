# Agent Note: ACP file location navigation

Status: implemented

English | [中文](2026-10-22-acp-file-locations.zh.md)

## Problem

ACP tool cards displayed reported line numbers separately from the file link. Opening a location discarded the line, and reopening the same file was treated as no navigation. Trimming trailing whitespace in the code viewer also removed addressable blank source lines.

## Decision

Carry an optional one-based source location independently of file identity through the shared file opener and preview. ACP locations use read-only source preview for text, Markdown and HTML. The existing code viewer reveals the line and highlights it for two seconds. A new location object requests another reveal, even for the same file and line. Missing or invalid positions keep file opening available; out-of-range lines have no highlight.

Embedded location changes do not reread file contents. File tabs keep their path-only URL and store the target in metadata, so different lines reuse the same tab. A normal tab open clears the earlier target. Without an embedded file opener, source links use the tab preview. Existing file-navigation generations reject stale metadata results, and text loading ignores late reads after replacement.

## Alternatives considered

- Include line numbers in file paths or tab URLs: confuses filesystem operations and creates duplicate file tabs.
- Build an ACP-only preview: duplicates existing loading, rendering and navigation behavior.
- Locate rendered Markdown or HTML DOM nodes: source lines do not correspond reliably to rendered elements.

## Consequences

No database migration, CLI configuration or model inference is required. Explicit source locations show source instead of rendered Markdown or HTML; ordinary opens retain their existing rendering behavior. The highlight is temporary and does not create a text selection.

## Verification

- Regression — Scoped renderer tests cover source-line navigation, repeated reveals, trailing blank lines, invalid positions, file-link activation and tab reuse/reset, alongside existing preview and Agent pane consumers.

- Electron — A controlled ACP process verifies long and wrapped source, Chinese paths, trailing blank lines, repeated positions, invalid/missing lines, Markdown source, latest navigation winning and empty-workspace tab fallback in light and dark themes; no renderer errors are recorded.
