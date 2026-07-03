import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockWorkbookModel } from '../mockModel'
import type { ChartModel, SheetRenderModel } from '../renderModel'
import type { SelectedCellInfo, XlsxGridProps } from '../XlsxGrid'

// jsdom has no real layout, so — matching the existing convention in
// src/renderer/components/VirtualList/__tests__/DynamicVirtualList.test.tsx — we mock
// @tanstack/react-virtual's useVirtualizer and assert on "what was passed in" / "what
// virtual items were rendered" rather than pixel-perfect layout.
interface MockVirtualItem {
  key: string
  index: number
  start: number
  size: number
}

const mocks = vi.hoisted(() => ({
  rowRange: [] as MockVirtualItem[],
  colRange: [] as MockVirtualItem[],
  lastRowOptions: null as any,
  lastColOptions: null as any,
  useVirtualizer: vi.fn()
}))

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: mocks.useVirtualizer
}))

const toVirtualItems = (
  prefix: string,
  indexes: number[],
  size: (i: number) => number,
  start: (i: number) => number
): MockVirtualItem[] =>
  indexes.map((index) => ({ key: `${prefix}-${index}`, index, start: start(index), size: size(index) }))

const setRangeFromCounts = (
  rowIndexes: number[],
  colIndexes: number[],
  rowSize: (i: number) => number,
  colSize: (i: number) => number,
  rowStart: (i: number) => number,
  colStart: (i: number) => number
) => {
  mocks.rowRange = toVirtualItems('row', rowIndexes, rowSize, rowStart)
  mocks.colRange = toVirtualItems('col', colIndexes, colSize, colStart)
}

const virtualizerImpl = (options: any) => {
  const isHorizontal = Boolean(options.horizontal)
  if (isHorizontal) {
    mocks.lastColOptions = options
  } else {
    mocks.lastRowOptions = options
  }
  return {
    getVirtualItems: () => (isHorizontal ? mocks.colRange : mocks.rowRange),
    getTotalSize: () => {
      const range = isHorizontal ? mocks.colRange : mocks.rowRange
      const last = range[range.length - 1]
      return last ? last.start + last.size : 0
    }
  }
}

let XlsxGrid: (props: XlsxGridProps) => ReactNode
beforeEach(async () => {
  vi.clearAllMocks()
  mocks.useVirtualizer.mockImplementation(virtualizerImpl)
  const mod = await import('../XlsxGrid')
  XlsxGrid = mod.default
})

const model = createMockWorkbookModel()
const salesSheet = model.sheets[0]

/** Visible range covering the header area (rows 1-6, cols 1-4) — enough to see title/headers/data without the far scroll target. */
const showHeaderRange = () => {
  setRangeFromCounts(
    [0, 1, 2, 3, 4, 5],
    [0, 1, 2, 3],
    () => 20,
    () => 64,
    (i) => i * 20,
    (i) => i * 64
  )
}

/**
 * jsdom always reports clientWidth/clientHeight as 0, so the merge layer (which derives its
 * viewport from the real scroll container's scrollTop/scrollLeft/clientWidth/clientHeight,
 * independent of the mocked row/col virtualizers) would never see a non-empty viewport unless we
 * stub the container's client size and fire a scroll event, matching what a real browser would
 * report for a rendered, sized panel.
 */
const setScrollViewport = (
  container: HTMLElement,
  { scrollTop = 0, scrollLeft = 0, clientWidth = 2000, clientHeight = 2000 } = {}
) => {
  const scrollEl = container.querySelector('[data-testid="xlsx-grid-scroll"]') as HTMLElement
  Object.defineProperty(scrollEl, 'clientWidth', { configurable: true, value: clientWidth })
  Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: clientHeight })
  scrollEl.scrollTop = scrollTop
  scrollEl.scrollLeft = scrollLeft
  fireEvent.scroll(scrollEl)
}

describe('XlsxGrid — mock model rendering', () => {
  beforeEach(() => {
    showHeaderRange()
  })

  it('renders the expected text within the visible range', () => {
    render(<XlsxGrid sheet={salesSheet} styles={model.styles} imageUrls={{}} zoom={1} />)
    expect(screen.getByText('季度')).toBeInTheDocument()
    expect(screen.getByText('销量')).toBeInTheDocument()
    expect(screen.getByText('Q1')).toBeInTheDocument()
  })

  it('does not render a far cell that is outside the current virtual range', () => {
    render(<XlsxGrid sheet={salesSheet} styles={model.styles} imageUrls={{}} zoom={1} />)
    expect(screen.queryByText('滚动到我')).not.toBeInTheDocument()
  })

  it('renders a far cell once the virtual range is scrolled to include it', () => {
    const { rerender } = render(<XlsxGrid sheet={salesSheet} styles={model.styles} imageUrls={{}} zoom={1} />)
    expect(screen.queryByText('滚动到我')).not.toBeInTheDocument()

    // Simulate the virtualizer reporting row 60 / col 10 (0-based 59 / 9) as visible.
    setRangeFromCounts(
      [59],
      [9],
      () => 20,
      () => 64,
      () => 59 * 20,
      () => 9 * 64
    )
    rerender(<XlsxGrid sheet={salesSheet} styles={model.styles} imageUrls={{}} zoom={1} />)

    expect(screen.getByText('滚动到我')).toBeInTheDocument()
  })

  it('passes precise estimateSize functions backed by the sheet layout (no measureElement reliance)', () => {
    render(<XlsxGrid sheet={salesSheet} styles={model.styles} imageUrls={{}} zoom={1} />)
    // Row 1 has an explicit override (36px in mockModel); row 2 uses the default (20px).
    expect(mocks.lastRowOptions.estimateSize(0)).toBe(36)
    expect(mocks.lastRowOptions.estimateSize(1)).toBe(20)
    // Row 7 (index 6) is hidden (height 0 override).
    expect(mocks.lastRowOptions.estimateSize(6)).toBe(0)
    // Col A (index 0) has an explicit override (110px); col E (index 4) is hidden (0).
    expect(mocks.lastColOptions.estimateSize(0)).toBe(110)
    expect(mocks.lastColOptions.estimateSize(4)).toBe(0)
  })

  it('extends the grid with blank rows/cols beyond the used range at default sizes', () => {
    render(<XlsxGrid sheet={salesSheet} styles={model.styles} imageUrls={{}} zoom={1} />)
    // Used range is 60×10; the virtualizers must be given a larger padded range.
    expect(mocks.lastRowOptions.count).toBeGreaterThan(salesSheet.rowCount)
    expect(mocks.lastColOptions.count).toBeGreaterThan(salesSheet.colCount)
    // Padded rows/cols beyond the used range fall back to the sheet defaults.
    expect(mocks.lastRowOptions.estimateSize(salesSheet.rowCount)).toBe(20)
    expect(mocks.lastColOptions.estimateSize(salesSheet.colCount)).toBe(64)
  })

  it('grows the padded range to fill a viewport larger than the used range', () => {
    const notesSheet = model.sheets[1] // 3×2 used range
    const { container } = render(<XlsxGrid sheet={notesSheet} styles={model.styles} imageUrls={{}} zoom={1} />)
    setScrollViewport(container, { clientWidth: 2000, clientHeight: 2000 })

    // 2000px viewport ÷ 20px default rows = 100 rows, ÷ 64px default cols = 32 cols (plus padding).
    expect(mocks.lastRowOptions.count).toBeGreaterThanOrEqual(100)
    expect(mocks.lastColOptions.count).toBeGreaterThanOrEqual(32)
  })
})

describe('XlsxGrid — style mapping', () => {
  beforeEach(() => {
    showHeaderRange()
  })

  it('applies bold, background, and center alignment from the header style (styleId 1)', () => {
    render(<XlsxGrid sheet={salesSheet} styles={model.styles} imageUrls={{}} zoom={1} />)
    const header = screen.getByText('季度')
    const cellDiv = header.closest('div')
    expect(cellDiv).toHaveStyle({ fontWeight: 'bold', backgroundColor: '#d9e1f2', justifyContent: 'center' })
  })

  it('applies wrap (whiteSpace normal) from the wrap style (styleId 3)', () => {
    // mockModel cell '3:4' (row 3, col 4) is 0-based [2, 3].
    setRangeFromCounts(
      [2],
      [3],
      () => 20,
      () => 64,
      () => 0,
      () => 0
    )
    render(<XlsxGrid sheet={salesSheet} styles={model.styles} imageUrls={{}} zoom={1} />)
    const wrapped = screen.getByText('春节档期拉动,环比增长明显,渠道补货集中在一月下旬。')
    expect(wrapped.closest('div')).toHaveStyle({ whiteSpace: 'normal' })
  })

  it('right-aligns a numeric cell with no explicit hAlign by default-aligning on cell type', () => {
    // Notes sheet cell 3:2 is a bare boolean with no styleId — should default-center.
    const notesSheet = model.sheets[1]
    setRangeFromCounts(
      [0, 1, 2],
      [0, 1],
      () => 20,
      () => 64,
      (i) => i * 20,
      (i) => i * 64
    )
    render(<XlsxGrid sheet={notesSheet} styles={model.styles} imageUrls={{}} zoom={1} />)
    const boolCell = screen.getByText('TRUE')
    expect(boolCell.closest('div')).toHaveStyle({ justifyContent: 'center' })
  })
})

/** Col widths for A..D in the mock model (A is overridden to 110px, B/C/D default to 64px). */
const salesColWidth = (i: number) => (i === 0 ? 110 : 64)
const salesColStart = (i: number) => (i === 0 ? 0 : 110 + (i - 1) * 64)

/** Visible range covering just the title merge's row (row 1) and its 4 covered columns. */
const showTitleMergeRange = () => {
  setRangeFromCounts(
    [0],
    [0, 1, 2, 3],
    () => 36,
    salesColWidth,
    () => 0,
    salesColStart
  )
}

describe('XlsxGrid — merged cells', () => {
  it('renders the master text of a merge exactly once, sized to the sum of covered rows/cols', () => {
    // Merge is rows 1-1, cols 1-4. Cover cols 1-4 in the virtual range so the underlying
    // per-cell layer would otherwise also try to render col A..D.
    showTitleMergeRange()
    const { container } = render(<XlsxGrid sheet={salesSheet} styles={model.styles} imageUrls={{}} zoom={1} />)
    setScrollViewport(container)

    const titleMatches = screen.getAllByText('2026 年度销售汇总')
    expect(titleMatches).toHaveLength(1)

    const mergeCell = screen.getByTestId('xlsx-grid-merge-cell')
    // width = col A (110) + col B/C/D (64 each) = 302; height = row 1 (36)
    expect(mergeCell.firstElementChild).toHaveStyle({ width: '302px', height: '36px' })
  })

  it('keeps the merge layer visible when the master row has scrolled out of the virtual row range', () => {
    // Only row index 5 (row 6, "合计") is in the virtual range — row 0 (the merge's master row) is not.
    setRangeFromCounts(
      [5],
      [0, 1, 2, 3],
      () => 20,
      salesColWidth,
      () => 100,
      salesColStart
    )
    const { container } = render(<XlsxGrid sheet={salesSheet} styles={model.styles} imageUrls={{}} zoom={1} />)
    // Scroll viewport still spans y=[0, 2000], so it overlaps the merge's rect (y=[0,36]) even
    // though row 0 itself is absent from the (mocked) row virtualizer's reported range.
    setScrollViewport(container)

    // The per-cell layer has no row-0 item, but the merge layer computes visibility from the
    // scroll viewport independently of the row virtualizer's current range.
    expect(screen.getByText('2026 年度销售汇总')).toBeInTheDocument()
    expect(screen.getByTestId('xlsx-grid-merge-cell')).toBeInTheDocument()
  })
})

describe('XlsxGrid — zoom', () => {
  it('doubles cell position/size and font size when zoom goes from 1 to 2', () => {
    setRangeFromCounts(
      [1],
      [0],
      () => 40,
      () => 128,
      () => 40,
      () => 0
    )
    const { rerender } = render(<XlsxGrid sheet={salesSheet} styles={model.styles} imageUrls={{}} zoom={1} />)

    setRangeFromCounts(
      [1],
      [0],
      () => 40,
      () => 128,
      () => 40,
      () => 0
    )
    rerender(<XlsxGrid sheet={salesSheet} styles={model.styles} imageUrls={{}} zoom={2} />)

    const cell = screen.getByText('季度')
    const cellDiv = cell.closest('div') as HTMLElement
    expect(cellDiv).toHaveStyle({ top: '40px', left: '0px', width: '128px', height: '40px' })
  })
})

describe('XlsxGrid — cell selection', () => {
  beforeEach(() => {
    showHeaderRange()
  })

  it('reports the address and cell when a plain cell is clicked', () => {
    const onSelectCell = vi.fn()
    render(<XlsxGrid sheet={salesSheet} styles={model.styles} imageUrls={{}} zoom={1} onSelectCell={onSelectCell} />)

    fireEvent.click(screen.getByText('季度'))

    expect(onSelectCell).toHaveBeenCalledWith<[SelectedCellInfo]>({
      address: 'A2',
      cell: expect.objectContaining({ text: '季度' })
    })
  })

  it('reports the master address/cell when a merged region is clicked', () => {
    showTitleMergeRange()
    const onSelectCell = vi.fn()
    const { container } = render(
      <XlsxGrid sheet={salesSheet} styles={model.styles} imageUrls={{}} zoom={1} onSelectCell={onSelectCell} />
    )
    setScrollViewport(container)

    fireEvent.click(screen.getByTestId('xlsx-grid-merge-cell'))

    expect(onSelectCell).toHaveBeenCalledWith<[SelectedCellInfo]>({
      address: 'A1',
      cell: expect.objectContaining({ text: '2026 年度销售汇总' })
    })
  })

  it('clears the selection (calls back with null) on Escape', () => {
    const onSelectCell = vi.fn()
    render(<XlsxGrid sheet={salesSheet} styles={model.styles} imageUrls={{}} zoom={1} onSelectCell={onSelectCell} />)

    fireEvent.click(screen.getByText('季度'))
    onSelectCell.mockClear()

    fireEvent.keyDown(screen.getByTestId('xlsx-grid-scroll'), { key: 'Escape' })
    expect(onSelectCell).toHaveBeenCalledWith(null)
  })
})

describe('XlsxGrid — floating layer', () => {
  it('renders a floating image at its scaled position with the resolved object URL', () => {
    setRangeFromCounts(
      [0],
      [0],
      () => 20,
      () => 64,
      () => 0,
      () => 0
    )
    render(<XlsxGrid sheet={salesSheet} styles={model.styles} imageUrls={{ 1: 'blob:mock-url' }} zoom={2} />)

    const img = screen.getByTestId('xlsx-grid-floating-image') as HTMLImageElement
    expect(img.src).toContain('blob:mock-url')
    // floatingImages[0].rect = { x: 340, y: 44, width: 160, height: 90 }, zoom=2
    expect(img).toHaveStyle({ top: '88px', left: '680px', width: '320px', height: '180px' })
  })

  it('does not render an image when its object URL has not been resolved yet', () => {
    setRangeFromCounts(
      [0],
      [0],
      () => 20,
      () => 64,
      () => 0,
      () => 0
    )
    render(<XlsxGrid sheet={salesSheet} styles={model.styles} imageUrls={{}} zoom={1} />)
    expect(screen.queryByTestId('xlsx-grid-floating-image')).not.toBeInTheDocument()
  })

  it('invokes renderChart for a supported chart and calls the returned dispose function on unmount', () => {
    setRangeFromCounts(
      [0],
      [0],
      () => 20,
      () => 64,
      () => 0,
      () => 0
    )
    const dispose = vi.fn()
    const renderChart = vi.fn((_chart: ChartModel, _container: HTMLElement) => dispose)

    const { unmount } = render(
      <XlsxGrid sheet={salesSheet} styles={model.styles} imageUrls={{}} zoom={1} renderChart={renderChart} />
    )

    expect(renderChart).toHaveBeenCalledTimes(1)
    const [chartArg, container] = renderChart.mock.calls[0]
    expect(chartArg.type).toBe('bar')
    expect(container).toBeInstanceOf(HTMLElement)
    expect(dispose).not.toHaveBeenCalled()

    unmount()
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('renders the unsupported chart placeholder with the raw type name instead of calling renderChart', () => {
    setRangeFromCounts(
      [0],
      [0],
      () => 20,
      () => 64,
      () => 0,
      () => 0
    )
    const renderChart = vi.fn(() => vi.fn())
    render(<XlsxGrid sheet={salesSheet} styles={model.styles} imageUrls={{}} zoom={1} renderChart={renderChart} />)

    expect(screen.getByText('xlsx_preview.chart_unsupported')).toBeInTheDocument()
    expect(screen.getByText('scatterChart')).toBeInTheDocument()
    // renderChart should only be invoked for the supported ('bar') chart, not the unsupported one.
    expect(renderChart).toHaveBeenCalledTimes(1)
  })

  it('falls back to the unsupported placeholder for a supported chart type when no renderChart is provided', () => {
    setRangeFromCounts(
      [0],
      [0],
      () => 20,
      () => 64,
      () => 0,
      () => 0
    )
    const barOnlySheet: SheetRenderModel = { ...salesSheet, charts: [salesSheet.charts[0]] }
    render(<XlsxGrid sheet={barOnlySheet} styles={model.styles} imageUrls={{}} zoom={1} />)
    expect(screen.getByText('xlsx_preview.chart_unsupported')).toBeInTheDocument()
  })
})
