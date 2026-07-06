import { describe, expect, it } from 'vitest'

import { axisOffsetPx } from '../worker/parseWorkbook'

/**
 * Guards drawing-anchor offset math. Anchor col/row come from untrusted XML, so the offset must be computed without
 * looping up to the coordinate — otherwise a huge <xdr:col>/<xdr:row> pins the parser worker.
 */
describe('axisOffsetPx — anchor offset is independent of coordinate magnitude', () => {
  it('sums default sizes for all preceding tracks when none are customized', () => {
    // 1-based line: offset of track 5 is the width of the 4 tracks before it.
    expect(axisOffsetPx(5, {}, 64)).toBe(4 * 64)
    expect(axisOffsetPx(1, {}, 64)).toBe(0)
  })

  it('corrects only custom-sized tracks that fall before the index', () => {
    expect(axisOffsetPx(5, { 2: 100 }, 64)).toBe(4 * 64 + (100 - 64))
    // A custom track at or after the index must not be counted.
    expect(axisOffsetPx(3, { 5: 200 }, 64)).toBe(2 * 64)
  })

  it('returns a finite offset for a hostile coordinate without iterating up to it', () => {
    // With the old loop this would iterate a billion times; here it is O(custom tracks).
    const start = performance.now()
    expect(axisOffsetPx(1_000_000_000, { 2: 100 }, 64)).toBe((1_000_000_000 - 1) * 64 + (100 - 64))
    expect(performance.now() - start).toBeLessThan(50)
  })

  it('treats non-positive coordinates as the sheet origin', () => {
    expect(axisOffsetPx(0, {}, 64)).toBe(0)
    expect(axisOffsetPx(-10, {}, 64)).toBe(0)
  })
})
