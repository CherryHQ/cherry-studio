# Agent Note: File link line navigation

Status: proposed

English | [中文](2026-11-18-file-link-line-navigation.zh.md)

## Problem

Chat file references can contain source locations, but `ClickableFilePath` removes colon-suffixed line and column numbers and Markdown file-link parsing drops fragments. File open actions and preview plugins receive a path without a location. A link to line 42 therefore opens the file without revealing that line. Agent file opening also routes HTML into the browser pane before source preview.

## Proposal

Parse file references into a filesystem path and an optional renderer-owned source location. Support `path:42`, `path:42:5`, `path#L42`, and `path#L42-L48` in clickable inline paths and local Markdown links. Lines are one-based and ranges inclusive. Preserve a supplied column in the location, but this first version promises line navigation and line highlighting only. Recognize location syntax before decoding a Markdown path so encoded filename punctuation remains literal. Preserve Windows drive prefixes, home expansion, workspace-relative resolution and existing link security. Ordinary fragments are not source locations and keep existing handling.

Use one location contract across Markdown file opening, `ClickableFilePath`, message actions and file-preview navigation. Keep path-only callers valid. Filesystem metadata, directory checks, copying paths, saving and external application opening receive only the filesystem path. External editor line navigation is outside this version.

The right-pane navigation owner carries the location with the accepted file-selection request. Every click is a navigation intent, including another click on the same file and line. Apply only the latest accepted intent after the matching file has loaded and its viewport is ready; obsolete asynchronous work must not move a newer file. Preserve dirty-edit confirmation and drafts. A canceled file change must not change the visible location. Opening a plain file or switching sessions clears the pending location.

Pass the location through `ArtifactPane` and `FilePreview` into the source viewer. Text files reveal and highlight the target line or inclusive range. Located Markdown and HTML files use their source view; located HTML bypasses browser routing. Links without locations retain current preview/browser behavior. Directories and binary previews retain their existing opening behavior without source highlighting; surfaces without an in-app preview retain their existing fallback.

`FileEditor` owns revealing and highlighting logical lines using Pierre's supported APIs and virtualization. Check the installed library's public APIs before implementation; if it cannot address virtualized logical lines reliably, improve that upstream capability rather than adding DOM queries or pixel estimates. Clamp a positive out-of-range location to the loaded document; reversed ranges and zero, unsafe or malformed numbers must not create a navigation request or crash. Navigation must not edit file contents or discard user selection outside the explicit navigation action.

## Alternatives considered

- Forward raw suffixed strings to file APIs: rejected because metadata and reads need the actual filesystem path.
- Add separate parsers to Markdown and clickable paths: rejected because path decoding, Windows prefixes and line syntax would diverge.
- Find a line element and call `scrollIntoView`: rejected because off-screen virtualized lines may have no DOM node.
- Open all located links in an external editor: rejected because this version targets the existing in-app preview and not editor-specific protocols.

## Acceptance criteria

- AC1 — Inline references and local Markdown links preserve the supported line/range syntax, Windows and workspace paths, and encoded filename punctuation; malformed locations create no navigation request (verification: unit tests for path and href parsing)
- AC2 — Clicking a located text file opens the preview and reveals/highlights the requested line or range after loading; plain links, directory opening and fallback surfaces retain existing behavior (verification: renderer integration tests and Electron interaction)
- AC3 — Repeated clicks on the same file work, the latest accepted navigation wins over delayed older requests, and canceled dirty-file transitions preserve drafts and the visible location (verification: renderer navigation tests)
- AC4 — Located Markdown and HTML links open source view at the requested lines, while unlocated links retain current rendered preview or browser routing (verification: renderer routing tests and Electron interaction)
- AC5 — A target outside the initially rendered portion of a large file is visible and highlighted after navigation, including wrapped lines; out-of-range targets clamp without modifying content (verification: Electron interaction with a large source fixture)
- AC6 — Changed-file formatting, focused affected-consumer tests, renderer type checking, documentation impact review and bilingual documentation checks pass; unverified runtime coverage is reported explicitly (verification: scoped local checks and docs gate)

## Risks

The current `FileEditor` uses Pierre `File` and a shared virtualizer, so a scrolling API on another Pierre component is not proof that this surface can navigate logical lines. Library compatibility must be established before choosing the implementation. Source-mode changes must cooperate with host editing state rather than remounting away unsaved work. Literal filenames ending in colon-number syntax remain ambiguous in inline references; encoded punctuation in explicit Markdown targets is the escape. Source line numbers refer to the currently loaded file, not a historical revision quoted in a message.
