# Agent Note: Keep screenshot exports with their capture session

Status: implemented

English | [中文](2026-11-08-screenshot-result-session-ownership.zh.md)

## Problem

Screenshot overlays reuse pooled windows. PNG encoding can finish after cancellation and window reuse, so checking only the sender window could accept an old image as a new capture. Repeated export actions could also open overlapping save operations. On macOS, an old save dialog's completion restored the current overlays without checking which session owned them, potentially covering a newer save panel.

## Decision

Result IPC carries the capture's existing `mediaId`; main accepts it only from the active overlay whose current media matches. The business result type remains image bytes. Renderer export work retains a token across PNG encoding and IPC, rejects duplicate work, and discards results invalidated by session end, capture replacement or overlay reset. Each main-process session admits one save operation at a time. A save completion releases only its own pending operation and restores overlays only while its session still owns them.

## Alternatives considered

- Checking the sender window alone cannot distinguish captures in a reused pooled window.
- Disabling a toolbar button alone does not cover keyboard submission or main-process admission.
- Slowing automation or forcing native focus would conceal the ownership race.

## Consequences

Cancelling a capture invalidates its pending export. Completing an old save cannot reveal a newer capture over its native panel or clear a newer save's pending state. A cancelled save can be retried. Native dialog ownership and ordinary capture interactions retain their existing contracts. This repair does not establish the cause of every reported screenshot freeze.

## Verification

- Regression — the two public-API save-dialog cancellation/error cases failed before the generation guard: the newer capture became visible while its native save was pending. All 89 service tests passed after that repair.
- Regression — `ScreenshotOverlayService.test.ts` and the screenshot IPC handler tests pass 106 checks covering pooled capture identity, stale requests, cancelled and failed dialogs, duplicate saves and file output.
- Regression — `CaptureOverlay.test.tsx`, `Toolbar.test.tsx` and `generateBlob.test.ts` pass 13 checks, including delayed real PNG encoding, duplicate exports, capture reuse and the older completion's inability to release a newer export.

- Regression — MP-128 passed in the normal 134-case local run at `00effcea97`, including save, pixel equality, OCR and chat delivery. Owned-runtime cleanup passed; that complete suite finished 127/134, so this case result is not full acceptance.
