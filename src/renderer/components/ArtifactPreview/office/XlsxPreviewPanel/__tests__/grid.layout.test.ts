import { describe, expect, it } from 'vitest'

import {
  axisOffset,
  buildAxisLayout,
  DEFAULT_FONT_SIZE_PX,
  DEFAULT_ROW_HEIGHT_PX,
  findCoveringMerge,
  mergeRectPx,
  mergesInView,
  scaledFontSizePx,
  WRAP_LINE_HEIGHT,
  wrapClampLines
} from '../gridLayout'

describe('buildAxisLayout', () => {
  it('builds a prefix-sum table using the default size when no override exists', () => {
    const layout = buildAxisLayout(3, 20, {}, 1)
    expect(layout.sizes).toEqual([20, 20, 20])
    expect(layout.offsets).toEqual([0, 20, 40])
    expect(layout.totalSize).toBe(60)
  })

  it('applies sparse overrides keyed by 1-based index', () => {
    const layout = buildAxisLayout(3, 20, { 2: 50 }, 1)
    expect(layout.sizes).toEqual([20, 50, 20])
    expect(layout.offsets).toEqual([0, 20, 70])
    expect(layout.totalSize).toBe(90)
  })

  it('treats a zero-size override (hidden row/col) as a zero-width slot, not a skip', () => {
    const layout = buildAxisLayout(3, 20, { 2: 0 }, 1)
    expect(layout.sizes).toEqual([20, 0, 20])
    expect(layout.offsets).toEqual([0, 20, 20])
    expect(layout.totalSize).toBe(40)
  })

  it('scales every size and offset by the zoom factor', () => {
    const layout = buildAxisLayout(2, 20, { 1: 30 }, 2)
    expect(layout.sizes).toEqual([60, 40])
    expect(layout.offsets).toEqual([0, 60])
    expect(layout.totalSize).toBe(100)
  })

  it('returns an empty layout for a zero count', () => {
    const layout = buildAxisLayout(0, 20, {}, 1)
    expect(layout.sizes).toEqual([])
    expect(layout.offsets).toEqual([])
    expect(layout.totalSize).toBe(0)
  })
})

describe('axisOffset', () => {
  const layout = buildAxisLayout(3, 20, {}, 1)

  it('looks up the offset of a valid 0-based index', () => {
    expect(axisOffset(layout, 0)).toBe(0)
    expect(axisOffset(layout, 1)).toBe(20)
    expect(axisOffset(layout, 2)).toBe(40)
  })

  it('clamps a negative index to 0', () => {
    expect(axisOffset(layout, -1)).toBe(0)
  })

  it('clamps an out-of-range index to the total size (one-past-the-end lookup)', () => {
    expect(axisOffset(layout, 3)).toBe(60)
    expect(axisOffset(layout, 100)).toBe(60)
  })
})

describe('mergeRectPx', () => {
  it('computes the pixel rect spanning the merged rows/cols', () => {
    const rowLayout = buildAxisLayout(5, 20, {}, 1)
    const colLayout = buildAxisLayout(5, 64, {}, 1)
    // merge covers rows 1-2, cols 1-4 (1-based, inclusive) — matches mockModel's title merge
    const rect = mergeRectPx({ top: 1, left: 1, bottom: 1, right: 4 }, rowLayout, colLayout)
    expect(rect).toEqual({ x: 0, y: 0, width: 64 * 4, height: 20 })
  })

  it('computes a rect for a merge that does not start at the origin', () => {
    const rowLayout = buildAxisLayout(5, 20, {}, 1)
    const colLayout = buildAxisLayout(5, 64, {}, 1)
    const rect = mergeRectPx({ top: 2, left: 2, bottom: 3, right: 3 }, rowLayout, colLayout)
    expect(rect).toEqual({ x: 64, y: 20, width: 64 * 2, height: 20 * 2 })
  })
})

describe('mergesInView', () => {
  const rowLayout = buildAxisLayout(100, 20, {}, 1)
  const colLayout = buildAxisLayout(20, 64, {}, 1)

  it('includes a merge that intersects the viewport', () => {
    const merges = [{ top: 1, left: 1, bottom: 1, right: 4 }]
    const result = mergesInView(merges, { top: 0, left: 0, bottom: 100, right: 300 }, rowLayout, colLayout)
    expect(result).toHaveLength(1)
    expect(result[0].masterRow).toBe(1)
    expect(result[0].masterCol).toBe(1)
    expect(result[0].rect).toEqual({ x: 0, y: 0, width: 64 * 4, height: 20 })
  })

  it('excludes a merge entirely outside the viewport', () => {
    const merges = [{ top: 1, left: 1, bottom: 1, right: 4 }]
    const result = mergesInView(merges, { top: 500, left: 500, bottom: 600, right: 600 }, rowLayout, colLayout)
    expect(result).toHaveLength(0)
  })

  it('keeps a merge visible when its master cell has scrolled out of view but the merged area still intersects', () => {
    // Merge spans rows 10-40 (tall), viewport only sees rows 30-35 — master row 10 is off-screen
    // but the merge rect (rows 10-40) still overlaps the [30,35] viewport window.
    const merges = [{ top: 10, left: 1, bottom: 40, right: 2 }]
    const viewportTop = axisOffset(rowLayout, 29) // start of row 30 (0-based index 29)
    const viewportBottom = axisOffset(rowLayout, 35)
    const result = mergesInView(
      merges,
      { top: viewportTop, left: 0, bottom: viewportBottom, right: 200 },
      rowLayout,
      colLayout
    )
    expect(result).toHaveLength(1)
    expect(result[0].masterRow).toBe(10)
    expect(result[0].masterCol).toBe(1)
  })

  it('treats a viewport edge that only touches (does not overlap) the merge as not intersecting', () => {
    const merges = [{ top: 1, left: 1, bottom: 2, right: 2 }]
    const mergeBottom = axisOffset(rowLayout, 2) // pixel just after the merge ends
    const result = mergesInView(
      merges,
      { top: mergeBottom, left: 0, bottom: mergeBottom + 100, right: 200 },
      rowLayout,
      colLayout
    )
    expect(result).toHaveLength(0)
  })
})

describe('findCoveringMerge', () => {
  const merges = [{ top: 2, left: 2, bottom: 4, right: 4 }]

  it('returns the merge covering an interior cell', () => {
    expect(findCoveringMerge(merges, 3, 3)).toBe(merges[0])
  })

  it('returns the merge for the master cell itself', () => {
    expect(findCoveringMerge(merges, 2, 2)).toBe(merges[0])
  })

  it('returns undefined for a cell outside every merge', () => {
    expect(findCoveringMerge(merges, 1, 1)).toBeUndefined()
    expect(findCoveringMerge(merges, 5, 5)).toBeUndefined()
  })
})

describe('scaledFontSizePx', () => {
  it('falls back to the Excel default (11pt) when fontSizePx is undefined', () => {
    expect(scaledFontSizePx(undefined, 1)).toBeCloseTo(DEFAULT_FONT_SIZE_PX)
  })

  it('scales an explicit font size by the zoom factor', () => {
    expect(scaledFontSizePx(16, 2)).toBe(32)
  })

  it('scales the default font size by the zoom factor too', () => {
    expect(scaledFontSizePx(undefined, 2)).toBeCloseTo(DEFAULT_FONT_SIZE_PX * 2)
  })
})

describe('wrapClampLines', () => {
  it('fits exactly one line in a default-height row at the default font size', () => {
    expect(wrapClampLines(DEFAULT_ROW_HEIGHT_PX, DEFAULT_FONT_SIZE_PX)).toBe(1)
  })

  it('only counts whole lines that fully fit the cell height', () => {
    // 40px / (14.67px * 1.3 ≈ 19.07px per line) ≈ 2.1 → 2 whole lines
    expect(wrapClampLines(40, DEFAULT_FONT_SIZE_PX)).toBe(2)
    expect(wrapClampLines(3 * DEFAULT_FONT_SIZE_PX * WRAP_LINE_HEIGHT, DEFAULT_FONT_SIZE_PX)).toBe(3)
  })

  it('never returns less than one line, even for rows shorter than a line', () => {
    expect(wrapClampLines(5, DEFAULT_FONT_SIZE_PX)).toBe(1)
    expect(wrapClampLines(0, DEFAULT_FONT_SIZE_PX)).toBe(1)
  })
})
