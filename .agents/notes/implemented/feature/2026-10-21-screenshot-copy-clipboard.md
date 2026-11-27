# Agent Note: Copying screenshot captures

Status: implemented

English | [中文](2026-10-21-screenshot-copy-clipboard.zh.md)

## Problem

The screenshot capture toolbar could save an image or copy it while closing the capture session. It had no action to copy the annotated capture and keep working in the overlay.

## Decision

The toolbar provides a separate copy action. It exports the current selection, including annotations, as PNG and sends it through a sender-guarded screenshot IPC route to the system clipboard. The existing copy-and-close action keeps its behavior.

## Alternatives considered

- A keyboard shortcut: not chosen because the issue requests a visible toolbar action.
- A save/confirm menu entry: not chosen because a direct button makes the action immediately available.

## Consequences

Users can paste the captured image without saving a file, then continue editing or choose another toolbar action. The new IPC operation reuses the existing screenshot result format and clipboard writer.

## Verification

- Regression — `pnpm test:renderer src/renderer/windows/screenshot/__tests__/Toolbar.test.tsx src/renderer/windows/screenshot/__tests__/geometry.test.ts`: 23 tests pass, including the copy action leaving the toolbar available.
- Regression — `pnpm test:main src/main/ipc/handlers/__tests__/screenshot.test.ts src/main/services/screenshot/__tests__/ScreenshotOverlayService.test.ts`: 102 tests pass, including clipboard output, preserved overlay session, and sender validation.
