# Agent Note: Update drag insertion position within a row

Status: implemented

English | [中文](2026-11-07-drag-insertion-position.zh.md)

## Problem

Regression MP-54 dragged the second pinned session above the first, but the insertion line remained below the target and the stored order did not change. The grouped list listened only to dnd-kit's `onDragOver`, which fires when the target ID changes. Moving from the lower half to the upper half of that same row left the insertion position stale.

## Decision

Update the existing drop state from `onDragMove` as well as `onDragOver`. Reuse the existing geometry, permission checks and equality guard. The final drop continues to use the visible insertion line, including the existing group append behavior.

## Alternatives considered

- Changing the test to jump directly above the row would avoid a normal user drag and conceal the failure.
- Recomputing only on release would leave the displayed insertion line inconsistent with the resulting order.

## Consequences

The insertion line follows movement within a target row. No ordering API, persistence format or cross-group permission changes are required.

## Verification

- Regression — the test moves the dragged item from the target's lower half to its upper half without changing the target ID, then checks the insertion line and final reorder payload. It failed before the fix.
- Regression — all 90 tests across GroupedSortableVirtualList and ResourceList passed after the fix.
- Full application drag and restart persistence remain part of MP-54 acceptance.
