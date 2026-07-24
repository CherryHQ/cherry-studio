import { describe, expect, it } from 'vitest'

import { applyHorizontalRubberBandTranslateX } from '../tabDragRubberBand'

const createRect = (left: number, width: number): DOMRectReadOnly => ({
  x: left,
  y: 0,
  top: 0,
  bottom: 30,
  left,
  right: left + width,
  width,
  height: 30,
  toJSON: () => ({})
})

const draggedRect = createRect(100, 90)
const boundaryRect = createRect(80, 420)

describe('applyHorizontalRubberBandTranslateX', () => {
  it('keeps movement unchanged while the dragged tab stays inside the boundary', () => {
    expect(applyHorizontalRubberBandTranslateX(-10, draggedRect, boundaryRect)).toBe(-10)
    expect(applyHorizontalRubberBandTranslateX(40, draggedRect, boundaryRect)).toBe(40)
  })

  it('hard-clamps overflow when no inset reserves room for rubber-band overdrag', () => {
    // Without insets the safe boundary equals the physical boundary, leaving
    // no overdrag budget — the function snaps to minX/maxX with no give.
    expect(applyHorizontalRubberBandTranslateX(-40, draggedRect, boundaryRect)).toBe(-20)
    expect(applyHorizontalRubberBandTranslateX(330, draggedRect, boundaryRect)).toBe(310)
    expect(applyHorizontalRubberBandTranslateX(-500, draggedRect, boundaryRect)).toBe(-20)
    expect(applyHorizontalRubberBandTranslateX(900, draggedRect, boundaryRect)).toBe(310)
  })

  it('damps overflow when inset reserves room for rubber-band overdrag', () => {
    const opts = { leftInset: 16, rightInset: 16 }

    const leftDamped = applyHorizontalRubberBandTranslateX(-40, draggedRect, boundaryRect, opts)
    expect(leftDamped).toBeLessThan(-4)
    expect(leftDamped).toBeGreaterThan(-40)
    expect(leftDamped).toBeCloseTo(-12.81, 2)

    const rightDamped = applyHorizontalRubberBandTranslateX(330, draggedRect, boundaryRect, opts)
    expect(rightDamped).toBeGreaterThan(294)
    expect(rightDamped).toBeLessThan(330)
    expect(rightDamped).toBeCloseTo(302.81, 2)
  })

  it('caps extreme overflow at the per-side overdrag budget', () => {
    const opts = { leftInset: 16, rightInset: 16 }

    expect(applyHorizontalRubberBandTranslateX(-500, draggedRect, boundaryRect, opts)).toBe(-16)
    expect(applyHorizontalRubberBandTranslateX(900, draggedRect, boundaryRect, opts)).toBe(306)
  })

  it('returns boundary values unchanged', () => {
    expect(applyHorizontalRubberBandTranslateX(-20, draggedRect, boundaryRect)).toBe(-20)
    expect(applyHorizontalRubberBandTranslateX(310, draggedRect, boundaryRect)).toBe(310)
  })

  it('uses left and right insets to reserve safe visual space', () => {
    expect(applyHorizontalRubberBandTranslateX(-500, draggedRect, boundaryRect, { leftInset: 16 })).toBe(-16)
    expect(applyHorizontalRubberBandTranslateX(900, draggedRect, boundaryRect, { rightInset: 16 + 28 + 6 })).toBe(272)
  })

  it('damps edge tabs inside reserved side insets without crossing physical bounds', () => {
    const leftEdgeDraggedRect = createRect(84, 90)
    const rightEdgeDraggedRect = createRect(400, 90)

    expect(applyHorizontalRubberBandTranslateX(6, leftEdgeDraggedRect, boundaryRect, { leftInset: 16 })).toBe(6)
    expect(applyHorizontalRubberBandTranslateX(-6, leftEdgeDraggedRect, boundaryRect, { leftInset: 16 })).toBeCloseTo(
      -1.49,
      2
    )
    expect(applyHorizontalRubberBandTranslateX(-500, leftEdgeDraggedRect, boundaryRect, { leftInset: 16 })).toBe(-4)
    expect(applyHorizontalRubberBandTranslateX(-6, rightEdgeDraggedRect, boundaryRect, { rightInset: 16 })).toBe(-6)
    expect(applyHorizontalRubberBandTranslateX(6, rightEdgeDraggedRect, boundaryRect, { rightInset: 16 })).toBeCloseTo(
      1.49,
      2
    )
    expect(applyHorizontalRubberBandTranslateX(500, rightEdgeDraggedRect, boundaryRect, { rightInset: 16 })).toBe(10)
  })

  it('allows a non-edge tab to reach the first tab position with left overdrag', () => {
    const secondDraggedRect = createRect(120, 90)

    expect(applyHorizontalRubberBandTranslateX(-500, secondDraggedRect, boundaryRect, { leftInset: 16 })).toBe(-36)
  })

  it('leaves movement unchanged when the boundary has no usable width', () => {
    const zeroWidthBoundaryRect = createRect(80, 0)

    expect(applyHorizontalRubberBandTranslateX(-40, draggedRect, zeroWidthBoundaryRect)).toBe(-40)
  })

  it('falls back to a physical-bounds clamp when the safe area is degenerate', () => {
    const narrowBoundaryRect = createRect(0, 200)
    const wideDraggedRect = createRect(0, 160)
    const opts = { leftInset: 16, rightInset: 50 }

    // Inside the physical bounds: returned unchanged
    expect(applyHorizontalRubberBandTranslateX(16, wideDraggedRect, narrowBoundaryRect, opts)).toBe(16)
    // Past the physical bounds: hard clamp instead of free-fly
    expect(applyHorizontalRubberBandTranslateX(-50, wideDraggedRect, narrowBoundaryRect, opts)).toBe(0)
    expect(applyHorizontalRubberBandTranslateX(100, wideDraggedRect, narrowBoundaryRect, opts)).toBe(40)
  })
})
