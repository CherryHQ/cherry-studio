# Agent Note: Notify code viewers when viewport visibility changes

Status: implemented

English | [中文](2026-11-09-code-viewer-visibility.zh.md)

## Problem

Expanded code viewers omit rows while outside the viewport. A short block can retain TanStack's `[0, 0]` row range while scrolling out and back in. During an ongoing scroll, the virtualizer updates its offset without notifying React when that range remains unchanged. After a message-list scroll compensation returns the block to view, its header is visible but its source remains hidden until the 150 ms scroll-end notification. Ready syntax then appears with the restored rows, making the problem look like a highlighting delay.

## Decision

Wrap the element and window offset observers to compare viewport visibility before and after updating the virtualizer. Notify its React adapter when this boundary changes, using cached geometry. Keep the existing row virtualization and off-screen omission. Newly visible viewers also give plain source a paint opportunity before their first syntax request.

## Alternatives considered

- Delay highlighting alone: rows can remain absent even with ready tokens or plain source available.
- Render every off-screen row: removes the visibility optimization instead of correcting its notification contract.
- Read rectangles during scrolling: cached offsets, viewport height, origin and total size already determine visibility; the [layout-origin decision](2026-10-31-code-viewer-layout-origin.md) keeps geometry reads on layout invalidation.

## Consequences

Short code blocks become readable as soon as they return to view during scrolling. Visibility crossings can notify React even when the row range stays unchanged. Ordinary offset updates keep TanStack's range-based notifications; no extra timer, per-frame observer or scroll-time rectangle read is introduced.

## Verification

- Regression — `CodeViewer.test.tsx` moves a one-line block outside and back into a real TanStack viewport during a continuing scroll: source must reappear immediately, before scroll-end. The previous implementation leaves it empty.
- Regression — `CodeViewer.firstPaint.test.tsx` resolves syntax immediately: complete plain source remains available before the first syntax request and ready tokens preserve its text.
- Electron — sending into an existing conversation and scrolling through code blocks reproduces visible empty bodies for about 150 ms before this repair. The same recorded scenario after the repair has no visible empty-body samples; new source appears before highlighting.
