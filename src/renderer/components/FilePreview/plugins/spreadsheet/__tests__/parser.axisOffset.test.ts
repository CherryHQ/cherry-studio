import { describe, expect, it } from 'vitest'

import { axisCountForPxExtent, axisOffsetPx, imageMimeForExtension } from '../worker/parseWorkbook'

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

describe('axisCountForPxExtent — drawing extents use sparse inverse lookup', () => {
  it('handles custom and hidden tracks at their exact boundaries', () => {
    const sizes = { 2: 100, 3: 0 }

    expect(axisCountForPxExtent(64, sizes, 64, 100)).toEqual({ count: 1, truncated: false })
    expect(axisCountForPxExtent(164, sizes, 64, 100)).toEqual({ count: 2, truncated: false })
    // Track 3 is hidden, so the first pixel after track 2 belongs to track 4.
    expect(axisCountForPxExtent(164.01, sizes, 64, 100)).toEqual({ count: 4, truncated: false })
  })

  it('caps a hostile extent without scanning every possible row', () => {
    const start = performance.now()
    expect(axisCountForPxExtent(Number.MAX_SAFE_INTEGER, { 2: 100 }, 20, 1_000_000_000)).toEqual({
      count: 1_000_000_000,
      truncated: true
    })
    expect(performance.now() - start).toBeLessThan(50)
  })
})

describe('imageMimeForExtension', () => {
  it('accepts known bitmap formats case-insensitively', () => {
    expect(imageMimeForExtension('PNG')).toBe('image/png')
    expect(imageMimeForExtension('jpeg')).toBe('image/jpeg')
    expect(imageMimeForExtension('webp')).toBe('image/webp')
  })

  it('rejects active or unknown embedded image formats', () => {
    expect(imageMimeForExtension('svg')).toBeUndefined()
    expect(imageMimeForExtension('html')).toBeUndefined()
    expect(imageMimeForExtension(undefined)).toBeUndefined()
  })
})
