import { describe, expect, it } from 'vitest'

import {
  computeInsertIndex,
  detectEdgeZone,
  edgeToSplit,
  isOutsideRectByMargin,
  type RectLike
} from '../paneDropDetection'

const rect: RectLike = { left: 100, top: 100, width: 400, height: 200 }

describe('detectEdgeZone (edgePct=0.25)', () => {
  it('returns "center" for the dead-center point', () => {
    expect(detectEdgeZone({ x: 300, y: 200 }, rect)).toBe('center')
  })

  it('returns "left" when pointer is in the left 25% strip', () => {
    expect(detectEdgeZone({ x: 110, y: 200 }, rect)).toBe('left')
  })

  it('returns "right" when pointer is in the right 25% strip', () => {
    expect(detectEdgeZone({ x: 490, y: 200 }, rect)).toBe('right')
  })

  it('returns "top" when pointer is in the top 25% strip', () => {
    // Outside left/right strips (dx = 0.5), dy ≈ 0.1 → top
    expect(detectEdgeZone({ x: 300, y: 120 }, rect)).toBe('top')
  })

  it('returns "bottom" when pointer is in the bottom 25% strip', () => {
    expect(detectEdgeZone({ x: 300, y: 280 }, rect)).toBe('bottom')
  })

  it('prefers horizontal edges over vertical when both strips overlap (corner)', () => {
    // Top-left corner — dx < 25% AND dy < 25%. Implementation checks left first.
    expect(detectEdgeZone({ x: 110, y: 110 }, rect)).toBe('left')
  })

  it('returns "center" for out-of-bounds points', () => {
    expect(detectEdgeZone({ x: -5, y: 150 }, rect)).toBe('center')
    expect(detectEdgeZone({ x: 600, y: 150 }, rect)).toBe('center')
    expect(detectEdgeZone({ x: 200, y: 50 }, rect)).toBe('center')
    expect(detectEdgeZone({ x: 200, y: 400 }, rect)).toBe('center')
  })

  it('returns "center" for degenerate rects', () => {
    const zero: RectLike = { left: 0, top: 0, width: 0, height: 0 }
    expect(detectEdgeZone({ x: 0, y: 0 }, zero)).toBe('center')
  })

  it('respects a custom edgePct', () => {
    // With edgePct=0.5 the entire rect except the exact center is an edge.
    // At dx = 0.3, dy = 0.5 → dx < 0.5 → left (left check wins before top/bottom).
    expect(detectEdgeZone({ x: 220, y: 200 }, rect, 0.5)).toBe('left')
    // At dx = 0.5, dy = 0.5 → neither left nor right nor top nor bottom → center
    expect(detectEdgeZone({ x: 300, y: 200 }, rect, 0.5)).toBe('center')
  })
})

describe('edgeToSplit', () => {
  it('maps left/right to horizontal split', () => {
    expect(edgeToSplit('left')).toEqual({ direction: 'horizontal', placement: 'before' })
    expect(edgeToSplit('right')).toEqual({ direction: 'horizontal', placement: 'after' })
  })

  it('maps top/bottom to vertical split', () => {
    expect(edgeToSplit('top')).toEqual({ direction: 'vertical', placement: 'before' })
    expect(edgeToSplit('bottom')).toEqual({ direction: 'vertical', placement: 'after' })
  })

  it('returns null for center', () => {
    expect(edgeToSplit('center')).toBeNull()
  })
})

describe('computeInsertIndex', () => {
  const tabs = [
    { rect: { left: 0, top: 0, width: 80, height: 30 } }, // midpoint = 40
    { rect: { left: 80, top: 0, width: 80, height: 30 } }, // midpoint = 120
    { rect: { left: 160, top: 0, width: 80, height: 30 } } // midpoint = 200
  ]

  it('returns 0 when pointer is before the first midpoint', () => {
    expect(computeInsertIndex({ x: 10 }, tabs)).toBe(0)
    expect(computeInsertIndex({ x: 39 }, tabs)).toBe(0)
  })

  it('returns 1 when pointer falls between first and second midpoints', () => {
    expect(computeInsertIndex({ x: 50 }, tabs)).toBe(1)
    expect(computeInsertIndex({ x: 119 }, tabs)).toBe(1)
  })

  it('returns 2 when pointer falls between second and third midpoints', () => {
    expect(computeInsertIndex({ x: 150 }, tabs)).toBe(2)
    expect(computeInsertIndex({ x: 199 }, tabs)).toBe(2)
  })

  it('returns tabs.length when pointer is past the last midpoint', () => {
    expect(computeInsertIndex({ x: 250 }, tabs)).toBe(3)
    expect(computeInsertIndex({ x: 1000 }, tabs)).toBe(3)
  })

  it('handles an empty tab list', () => {
    expect(computeInsertIndex({ x: 0 }, [])).toBe(0)
  })
})

describe('isOutsideRectByMargin', () => {
  it('returns false when pointer is inside the rect', () => {
    expect(isOutsideRectByMargin({ x: 300, y: 200 }, rect, 30)).toBe(false)
  })

  it('returns false when pointer is within the margin', () => {
    expect(isOutsideRectByMargin({ x: 90, y: 200 }, rect, 30)).toBe(false)
    expect(isOutsideRectByMargin({ x: 520, y: 200 }, rect, 30)).toBe(false)
  })

  it('returns true when pointer exceeds the margin in any direction', () => {
    expect(isOutsideRectByMargin({ x: 50, y: 200 }, rect, 30)).toBe(true) // left
    expect(isOutsideRectByMargin({ x: 550, y: 200 }, rect, 30)).toBe(true) // right
    expect(isOutsideRectByMargin({ x: 300, y: 50 }, rect, 30)).toBe(true) // top
    expect(isOutsideRectByMargin({ x: 300, y: 400 }, rect, 30)).toBe(true) // bottom
  })
})
