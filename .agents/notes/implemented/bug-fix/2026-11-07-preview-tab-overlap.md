# Agent Note: Keep preview tab controls reachable in narrow panes

Status: implemented

English | [中文](2026-11-07-preview-tab-overlap.zh.md)

## Problem

MP-19 opens two file previews in the default narrow Agent pane. The active tab stays visible, but its fixed minimum width plus the overflow button exceeds the remaining header space. The overflow button covers the active tab's close button, preventing a normal pointer click.

## Decision

Let the tab list consume the available flex space and let individual tabs shrink below their preferred width. Keep the close button and overflow button at their existing sizes, truncate the title, and preserve active-tab placement and overflow menu behavior.

## Alternatives considered

- Forcing E2E clicks through the overlapping control would hide a user-facing failure.
- Widening every preview pane would change the user's conversation layout to accommodate a header defect.

## Consequences

Narrow headers show shorter titles while keeping both controls reachable. The tab-capacity calculation and the context menu remain unchanged.

## Verification

- Regression — MP-19 captured overlapping controls and failed its normal click on the selected second file's close button before the fix. Its close-and-fallback assertions remain the application-level check.

- Regression — MP-19 passed in the real Electron app after the fix, including normal pointer closing of the active overflowed tab, fallback selection, DOCX/video previews and selected-text clipboard round trip.
