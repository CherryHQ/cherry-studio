import type { PaneDirection } from '@shared/data/cache/cacheValueTypes'

/** Which zone of a pane's content rect a pointer is in. */
export type EdgeZone = 'top' | 'right' | 'bottom' | 'left' | 'center'

export interface Point {
  x: number
  y: number
}

/** A minimal rect shape compatible with DOMRect. */
export interface RectLike {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Classify a pointer position against a pane's content rect.
 *
 * With the default `edgePct = 0.25`, the four edge strips occupy 25% of each
 * dimension (so the outer ring is 50% of area) and the inner center region is
 * the remaining inner 50%. This matches the "Obsidian-style 50% center" target
 * from the Phase 3 plan.
 *
 * Out-of-bounds points return `'center'` — callers decide whether to treat
 * them as misses or as a merge-to-center action.
 */
export function detectEdgeZone(pt: Point, rect: RectLike, edgePct = 0.25): EdgeZone {
  if (rect.width <= 0 || rect.height <= 0) return 'center'

  const dx = (pt.x - rect.left) / rect.width
  const dy = (pt.y - rect.top) / rect.height

  if (dx < 0 || dx > 1 || dy < 0 || dy > 1) return 'center'

  if (dx < edgePct) return 'left'
  if (dx > 1 - edgePct) return 'right'
  if (dy < edgePct) return 'top'
  if (dy > 1 - edgePct) return 'bottom'
  return 'center'
}

/** Map an edge zone to a split direction and placement for `splitPaneWithTab`. */
export function edgeToSplit(zone: EdgeZone): { direction: PaneDirection; placement: 'before' | 'after' } | null {
  switch (zone) {
    case 'left':
      return { direction: 'horizontal', placement: 'before' }
    case 'right':
      return { direction: 'horizontal', placement: 'after' }
    case 'top':
      return { direction: 'vertical', placement: 'before' }
    case 'bottom':
      return { direction: 'vertical', placement: 'after' }
    case 'center':
      return null
  }
}

/**
 * Given a pointer's x coordinate and the tab buttons' rects (in visual order),
 * return the insertion index in the range [0, tabs.length].
 *
 * Rule: insert before the first tab whose horizontal midpoint is to the right
 * of the pointer; otherwise append at the end.
 */
export function computeInsertIndex(pt: { x: number }, tabButtonRects: Array<{ rect: RectLike }>): number {
  for (let i = 0; i < tabButtonRects.length; i++) {
    const entry = tabButtonRects[i]
    if (!entry) continue
    const midX = entry.rect.left + entry.rect.width / 2
    if (pt.x < midX) return i
  }
  return tabButtonRects.length
}

/**
 * Return true if the point lies outside the rect by at least `threshold` pixels
 * in any direction. Used by detach logic to decide whether a drop is "out of
 * the window" enough to spawn a detached window.
 */
export function isOutsideRectByMargin(pt: Point, rect: RectLike, threshold: number): boolean {
  return (
    pt.x < rect.left - threshold ||
    pt.x > rect.left + rect.width + threshold ||
    pt.y < rect.top - threshold ||
    pt.y > rect.top + rect.height + threshold
  )
}
