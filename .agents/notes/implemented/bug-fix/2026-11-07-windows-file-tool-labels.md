# Agent Note: Show filenames in Windows file-tool cards

Status: implemented

English | [中文](2026-11-07-windows-file-tool-labels.zh.md)

## Problem

The Windows permission E2E successfully creates its file, but the Write card displays the whole backslash-separated path instead of the filename. Read, Edit and MultiEdit use the same slash-only extraction and have the same defect.

## Decision

Reuse the renderer's existing cross-platform file-preview filename helper for all four cards. Keep the complete path as the click target and leave write-success gating unchanged.

## Alternatives considered

- Relaxing the E2E label assertion would preserve an inconsistent Windows display.
- Adding another path parser would duplicate the existing helper.

## Consequences

File-tool labels consistently show the final filename on Windows and POSIX. File access and preview targets remain unchanged. The separate Memory E2E accepts Windows inline-code paths because that renderer intentionally does not promote them to links; it still verifies real file contents and recall in a new session.

## Verification

- Regression — all four Windows filename cases failed before the fix while the existing 50 renderer cases passed.
- Regression — 99 focused renderer and file-preview tests passed after the fix; Web/E2E types and scoped lint passed. Hosted Windows E2E verification remains required.
