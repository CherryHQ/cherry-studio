# Agent Note: Code viewer origins follow layout changes

Status: implemented

English | [中文](2026-10-31-code-viewer-layout-origin.zh.md)

## Problem

Expanded `CodeViewer` instances use an outer scroll container. Their `scrollMargin` is the code list's origin in the scrollable content, which stays constant during ordinary scrolling. A scroll listener introduced in PR #22469 nevertheless reads the list and container rectangles and submits that origin on every scroll event. Equal-state submission can still cause redundant component executions alongside the virtualizer's synchronous updates.

Removing the listener alone leaves gaps in position tracking. A preceding sibling can resize inside a fixed-height ancestor, and Virtua can change a message wrapper's `top` without resizing it. Both move a code block without a resize notification on the previously observed ancestors.

## Decision

Measure the origin initially and on layout invalidation, retaining equality deduplication before updating state. Observe the viewer root, its ancestors through the scroll container, and their preceding siblings with `ResizeObserver`. Observe ancestor `style`/`class` attributes and direct child-list changes, plus preceding sibling `style`/`class` attributes, with `MutationObserver`. Refresh observations after child-list changes so added siblings participate and removed nodes are released.

Do not observe the viewer's virtual rows or syntax-token subtree. Their scrolling and highlighting updates must not become layout-origin invalidations. Disconnect both observers on effect cleanup. Preserve the existing scroll listener for selection bookkeeping and the virtualizer's own scroll subscription.

## Alternatives considered

- Equality deduplication alone reduces redundant state submissions but keeps rectangle reads in every scroll callback.
- Observing only ancestor sizes misses sibling growth inside fixed-height containers and position-only virtual-item changes.
- Observing the entire message subtree would turn row virtualization and syntax highlighting into repeated geometry reads.
- Short-block rendering thresholds and a different virtualizer are separate optimizations, outside this repair.

## Consequences

Ordinary scroll dispatch no longer measures the code-list origin. Layout notifications still require geometry reads; attribute observation is conservative and can also react to non-geometric changes, including Virtua toggling `pointer-events` at scroll start and end. No polling or per-frame position observer is introduced. Existing row sizing, anchoring, selection, capture and highlighting behavior remains unchanged.

## Verification

- Regression — `pnpm test:renderer src/renderer/components/__tests__/CodeViewer.test.tsx`: scroll advances virtual rows without reading the list origin; preceding sibling resize, ancestor repositioning and sibling insertion/removal update displayed rows without a scroll event.
- Regression — `tests/e2e/ondemand/specs/code-block-scroll.ts`: real message-list wheel scrolling performs no code-list rectangle reads during scroll dispatch, preserves source lines in visible blocks and restores the first block when scrolling back.
