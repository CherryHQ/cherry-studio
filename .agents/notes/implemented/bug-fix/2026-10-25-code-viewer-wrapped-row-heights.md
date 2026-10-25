# Agent Note: Wrapped code rows keep measured heights across width changes

Status: implemented

English | [中文](2026-10-25-code-viewer-wrapped-row-heights.zh.md)

## Problem

`CodeViewer` virtualizes code rows and estimates wrapped row heights from a character-count heuristic. Every scroller width change calls `virtualizer.measure()`, which drops all cached row sizes, while mounted rows never re-run `measureElement`. Their heights therefore fall back to estimates until their own layout changes. For CJK-heavy lines the heuristic undercounts wraps, so the virtual list becomes shorter than the absolutely positioned rows and the collapsed scroller overflows. A 6px classic scrollbar then narrows the content, flips the estimate again, and the block oscillates between seven and eight rows at frame rate. React also commits the corrected list height after paint, so even without the loop the stale height can flash a scrollbar for one frame. Seeding alone is insufficient: after `measure()` the baseline is an estimate, so reseeding every mounted row would treat the estimate error as row growth and scroll an already-scrolled viewer.

## Decision

After `measure()`, the viewer rebuilds measurements from estimates and then reseeds every mounted row from its real `offsetHeight`, so the list height always covers the rendered rows and no scrollbar can appear. Before dropping the cache, it feeds the same real heights into the old cache so genuine wrap changes keep the reading anchor; the rebuild itself runs with `shouldAdjustScrollPositionOnItemSizeChange` disabled and restores the previous value, because every remaining delta is estimate error. The width ResizeObserver observes a zero-height width probe instead of the scroller: synchronizing the list height inside a callback that resizes the observed element triggers the ResizeObserver loop error. The callback also writes the corrected list height synchronously because React commits after paint; the later render writes the same value. Image capture skips remeasurement while it renders every row.

## Alternatives considered

- `scrollbar-gutter: stable` stops the width feedback but leaves the list height wrong and still paints the transient scrollbar.
- `flushSync` removes the one-frame delay for both height and transform but forces a synchronous component render and is rejected by the repository lint rule.
- A better width heuristic narrows the mismatch band but cannot make estimates match layout for arbitrary fonts and break opportunities.
- Skipping `measure()` on width changes keeps measured heights for mounted rows but restores stale sizes and scroll drift for unmounted rows.
- Snapshotting and restoring `scrollTop` would also undo the genuine compensation applied before the rebuild and needs separate element and window handling.
- Recomputing the anchor from the first visible row duplicates TanStack's anchoring, including scroll margins and clamping.

## Consequences

Mounted rows are authoritative after every width or layout change; unmounted rows keep width-aware estimates until they mount. A width change costs one `offsetHeight` read per mounted row (viewport plus overscan). Genuine height changes are applied before the cache is rebuilt, so anchor preservation no longer depends on ResizeObserver delivery order or the layout-effect path, and estimate error never scrolls the viewer. Synchronizing the height does not update the anchored transform, which follows with the next React commit; this is invisible at the top of a block and self-corrects when scrolled. Capture still renders the full document.

## Verification

- Regression — `pnpm test:renderer src/renderer/components/__tests__/CodeViewer.test.tsx`: a two-line row keeps its measured height across width changes and the list height is synced inside the observer callback before React commits; removing either the reseed or the synchronous write fails.
- Regression — `pnpm test:renderer src/renderer/components/__tests__/CodeViewer.test.tsx`: a scrolled viewer whose rows keep their heights retains `scrollTop` after a width change; without suppressing compensation the check jumps from `450` to `1710`.
- Regression — `pnpm test:renderer src/renderer/components/CodeBlockView/__tests__/CodeBlockView.test.tsx`: collapsed and expanded code block integration still passes.
- Regression — Manual Electron: dragging the sidebar at the previous threshold no longer alternates between seven and eight rows or flashes a scrollbar.
