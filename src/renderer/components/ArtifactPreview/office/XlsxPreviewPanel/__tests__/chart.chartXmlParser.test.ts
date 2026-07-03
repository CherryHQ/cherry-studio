import { describe, expect, it } from 'vitest'

import { DEFAULT_COL_WIDTH_PX, DEFAULT_ROW_HEIGHT_PX } from '../gridLayout'
import type { SheetDataAccessor, SheetLayoutAccessor } from '../worker/chartXmlParser'
import { parseCharts } from '../worker/chartXmlParser'
import { buildChartWorkbookZip } from './xlsxTestPackages'

/** Default column width / row height for every column/row — mirrors an unstyled sheet. */
const DEFAULT_LAYOUT: SheetLayoutAccessor = {
  colX: (col) => (col - 1) * DEFAULT_COL_WIDTH_PX,
  rowY: (row) => (row - 1) * DEFAULT_ROW_HEIGHT_PX
}

const emptyDataAccessor: SheetDataAccessor = {
  readRange: () => null
}

describe('parseCharts — generated chart workbook with cache', () => {
  it('parses all four chart types with categories/values/title from cache', async () => {
    const zip = await buildChartWorkbookZip('basic')
    const { charts, warnings } = await parseCharts(zip, 'Data', DEFAULT_LAYOUT, emptyDataAccessor)

    // bar (stacked, col) + bar (horizontal) + line + pie + area
    expect(charts).toHaveLength(5)

    const bar = charts[0]
    expect(bar.type).toBe('bar')
    expect(bar.barDirection).toBe('col')
    expect(bar.stacked).toBe(true)
    expect(bar.title).toBe('Bar Chart')
    expect(bar.series).toHaveLength(2)
    expect(bar.series[0]).toEqual({
      name: 'SeriesA',
      categories: ['Q1', 'Q2', 'Q3', 'Q4'],
      values: [10, 20, 30, 40]
    })
    expect(bar.series[1]).toEqual({
      name: 'SeriesB',
      categories: ['Q1', 'Q2', 'Q3', 'Q4'],
      values: [5, 15, 25, 35]
    })

    const hbar = charts[1]
    expect(hbar.type).toBe('bar')
    expect(hbar.barDirection).toBe('bar')
    expect(hbar.stacked).toBeUndefined()
    expect(hbar.title).toBe('Horizontal Bar Chart')

    const line = charts[2]
    expect(line.type).toBe('line')
    expect(line.title).toBe('Line Chart')
    expect(line.series[0].values).toEqual([10, 20, 30, 40])

    const pie = charts[3]
    expect(pie.type).toBe('pie')
    expect(pie.title).toBe('Pie Chart')
    expect(pie.series[0].categories).toEqual(['Q1', 'Q2', 'Q3', 'Q4'])

    const area = charts[4]
    expect(area.type).toBe('area')
    expect(area.title).toBe('Area Chart')

    expect(warnings).toEqual([])
  })

  it('computes PxRect from oneCellAnchor using layout.colX/rowY + ext EMU', async () => {
    const zip = await buildChartWorkbookZip('basic')
    const { charts } = await parseCharts(zip, 'Data', DEFAULT_LAYOUT, emptyDataAccessor)

    // First chart anchored at col=4 (0-based) row=1 (0-based) → col E, row 2 (1-based)
    const bar = charts[0]
    expect(bar.rect.x).toBeCloseTo(DEFAULT_LAYOUT.colX(5), 5) // 1-based col 5 = 'E'
    expect(bar.rect.y).toBeCloseTo(DEFAULT_LAYOUT.rowY(2), 5)
    expect(bar.rect.width).toBeGreaterThan(0)
    expect(bar.rect.height).toBeGreaterThan(0)
  })
})

describe('parseCharts — generated reference-only chart workbook', () => {
  it('falls back to SheetDataAccessor.readRange when cache is absent', async () => {
    const zip = await buildChartWorkbookZip('no-cache')
    const seenRefs: string[] = []
    const accessor: SheetDataAccessor = {
      readRange: (ref) => {
        seenRefs.push(ref)
        if (ref.includes('$A$')) return [['Q1'], ['Q2'], ['Q3'], ['Q4']]
        if (ref.includes('$B$')) return [[10], [20], [30], [40]]
        if (ref === "'Data'!B1") return [['SeriesA']]
        return null
      }
    }

    const { charts, warnings } = await parseCharts(zip, 'Data', DEFAULT_LAYOUT, accessor)

    expect(charts).toHaveLength(4)
    for (const chart of charts) {
      expect(chart.series[0].categories).toEqual(['Q1', 'Q2', 'Q3', 'Q4'])
      expect(chart.series[0].values).toEqual([10, 20, 30, 40])
      expect(chart.series[0].name).toBe('SeriesA')
    }
    expect(warnings).toEqual([])
    expect(seenRefs.length).toBeGreaterThan(0)
    expect(seenRefs.some((ref) => ref.includes('$A$2:$A$5'))).toBe(true)
    expect(seenRefs.some((ref) => ref.includes('$B$1:$B$5') || ref.includes('$B$2:$B$5'))).toBe(true)
  })

  it('produces an empty series with a warning when both cache and reference resolve to nothing', async () => {
    const zip = await buildChartWorkbookZip('no-cache')
    const { charts, warnings } = await parseCharts(zip, 'Data', DEFAULT_LAYOUT, emptyDataAccessor)

    expect(charts).toHaveLength(4)
    for (const chart of charts) {
      expect(chart.series[0].values).toEqual([])
      // categories fall back to 1..n sequence when both cache and reference are empty,
      // but with 0 values there is nothing to number either.
      expect(chart.series[0].categories).toEqual([])
    }
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings.some((w) => w.includes('no category and value data'))).toBe(true)
  })
})

describe('parseCharts — generated workbook with unsupported chart type', () => {
  it('reports unsupported chart types with rawTypeName', async () => {
    const zip = await buildChartWorkbookZip('unsupported')
    const { charts, warnings } = await parseCharts(zip, 'Data', DEFAULT_LAYOUT, emptyDataAccessor)

    expect(charts).toHaveLength(1)
    expect(charts[0].type).toBe('unsupported')
    expect(charts[0].rawTypeName).toBe('scatterChart')
    expect(charts[0].series).toEqual([])
    expect(warnings).toEqual([])
  })
})

describe('parseCharts — sheet without drawing/charts', () => {
  it('returns an empty result when the sheet has no drawing relationship', async () => {
    const zip = await buildChartWorkbookZip('basic')
    const { charts, warnings } = await parseCharts(zip, 'NonExistentSheet', DEFAULT_LAYOUT, emptyDataAccessor)
    expect(charts).toEqual([])
    expect(warnings).toEqual([])
  })
})
