# Agent Note: Reading state survives document refresh

Status: implemented

English | [中文](2026-10-21-preview-refresh-reading-state.zh.md)

## Problem

Refreshing a file remounts the desktop preview and the portable format. The fresh document therefore loses zoom, page, scroll, worksheet and image transforms. Removing only the desktop refresh key does not repair the portable host or the formats that explicitly reset their state.

## Decision

The desktop host identifies a preview by normalized path and format; the portable host uses source ID and format. Refresh replaces metadata and the opened document without replacing a compatible format component. Each format owns its reading state and resource teardown. Shorter content clamps the position; another file or format resets it.

The previous document still closes when refresh begins. A retained plugin cannot publish selections or terminal failures for a newer committed request. The consumer clears held selections immediately; format plugins cancel obsolete selection work. PDF and PPTX capture position before Activity hides their viewport and restore it after rebuilding resources.

## Alternatives considered

- Removing only the outer React key leaves the portable host and explicit format resets unchanged.
- A shared persistent reading-state cache duplicates format ownership and adds close/reopen history beyond this repair.
- Reusing an old document or skipping reload preserves stale bytes and violates source-session lifetimes.

## Consequences

Reading state lasts for the mounted preview, with format-specific validity checks. Source access, version checks, size limits, worker cleanup and HTML sandbox policies retain their owners. HTML recreates its restricted iframe after a successful read, including unchanged text, while retaining source/preview mode. Failed previews remain retryable; the repair does not promise persistent history after a failed session or unmount.

## Verification

- Regression — `Preview.test.tsx`: a deferred same-source refresh retains page and old content, accepts the replacement, resets for another source, reconnects through Activity and rejects obsolete selections and failures.
- Regression — format and desktop preview tests cover content reload, retained zoom/page/worksheet/transforms, shorter content and refresh selection invalidation.
