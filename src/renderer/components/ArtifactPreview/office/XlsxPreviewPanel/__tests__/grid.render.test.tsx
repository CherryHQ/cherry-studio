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
  rowScrollToIndex: vi.fn(),
  colScrollToIndex: vi.fn(),
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
    },
    scrollToIndex: isHorizontal ? mocks.colScrollToIndex : mocks.rowScrollToIndex
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
    expect(screen.getByText('Quarter')).toBeInTheDocument()
    expect(screen.getByText('Sales')).toBeInTheDocument()
    expect(screen.getByText('Q1')).toBeInTheDocument()
  })

  it('does not render a far cell that is outside the current virtual range', () => {
    render(<XlsxGrid sheet={salesSheet} styles={model.styles} imageUrls={{}} zoom={1} />)
    expect(screen.queryByText('Scroll to me')).not.toBeInTheDocument()
  })

  it('renders a far cell once the virtual range is scrolled to include it', () => {
    const { rerender } = render(<XlsxGrid sheet={salesSheet} styles={model.styles} imageUrls={{}} zoom={1} />)
    expect(screen.queryByText('Scroll to me')).not.toBeInTheDocument()

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

    expect(screen.getByText('Scroll to me')).toBeInTheDocument()
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
    const header = screen.getByText('Quarter')
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
    const wrapped = screen.getByText(
      'Holiday campaign boosted demand, with channel restocking concentrated in late January.'
    )
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

    const titleMatches = screen.getAllByText('2026 Sales Summary')
    expect(titleMatches).toHaveLength(1)

    const mergeCell = screen.getByTestId('xlsx-grid-merge-cell')
    // width = col A (110) + col B/C/D (64 each) = 302; height = row 1 (36)
    expect(mergeCell.firstElementChild).toHaveStyle({ width: '302px', height: '36px' })
  })

  it('exposes the merge as one spanning gridcell in its real row and keeps the overlay presentational', () => {
    // Merge is rows 1-1, cols 1-4: the master cell in the base row must be the only semantic gridcell,
    // exposing span metadata and the cell text; the visual merge overlay must be hidden from the a11y tree.
    showTitleMergeRange()
    const { container } = render(<XlsxGrid sheet={salesSheet} styles={model.styles} imageUrls={{}} zoom={1} />)
    setScrollViewport(container)

    // Exactly one row 1 — the merge overlay no longer duplicates row semantics.
    const rows = container.querySelectorAll('[role="row"][aria-rowindex="1"]')
    expect(rows).toHaveLength(1)

    const masterCells = container.querySelectorAll('[role="gridcell"][aria-colindex="1"]')
    expect(masterCells).toHaveLength(1)
    const master = masterCells[0]
    expect(rows[0].contains(master)).toBe(true)
    expect(master).toHaveAttribute('aria-colspan', '4')
    expect(master).toHaveAttribute('aria-rowspan', '1')
    expect(master).toHaveAttribute('aria-label', '2026 Sales Summary')

    // The 3 covered base-layer placeholders have no gridcell role and are aria-hidden.
    expect(rows[0].querySelectorAll('[role="gridcell"]')).toHaveLength(1)
    expect(rows[0].querySelectorAll('[aria-hidden="true"]')).toHaveLength(3)

    // The merge overlay paints the visual but carries no grid semantics.
    const overlay = screen.getByTestId('xlsx-grid-merge-cell')
    expect(overlay.closest('[aria-hidden="true"]')).not.toBeNull()
    expect(overlay.closest('[role="row"]')).toBeNull()
  })

  it('keeps the merge layer visible when the master row has scrolled out of the virtual row range', () => {
    // Only row index 5 (row 6, "Total") is in the virtual range — row 0 (the merge's master row) is not.
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
    expect(screen.getByText('2026 Sales Summary')).toBeInTheDocument()
    expect(screen.getByTestId('xlsx-grid-merge-cell')).toBeInTheDocument()
  })
})

describe('XlsxGrid — zoom', () => {
  it('scales photographically: cell layout stays at zoom=1 and only the transform changes', () => {
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

    // Cell 2:1 keeps its zoom=1 geometry (row 1 override 36 → top, col A 110 wide, row 2 default 20 tall)
    const cell = screen.getByText('Quarter')
    const cellDiv = cell.closest('div') as HTMLElement
    expect(cellDiv).toHaveStyle({ top: '36px', left: '0px', width: '110px', height: '20px' })
    // The whole content layer is scaled as one image instead
    expect(screen.getByTestId('xlsx-grid-zoom-layer')).toHaveStyle({ transform: 'scale(2)' })
  })

  it('feeds the virtualizer scroll-space (scaled) sizes while rendering unscaled coordinates', () => {
    setRangeFromCounts(
      [0],
      [0],
      () => 72,
      () => 220,
      () => 0,
      () => 0
    )
    render(<XlsxGrid sheet={salesSheet} styles={model.styles} imageUrls={{}} zoom={2} />)

    // Row 1 has a 36px override, col A a 110px override — scroll space doubles them at zoom 2.
    expect(mocks.lastRowOptions.estimateSize(0)).toBe(72)
    expect(mocks.lastColOptions.estimateSize(0)).toBe(220)
  })
})

describe('XlsxGrid — cell selection', () => {
  beforeEach(() => {
    showHeaderRange()
  })

  it('reports the address and cell when a plain cell is clicked', () => {
    const onSelectCell = vi.fn()
    render(<XlsxGrid sheet={salesSheet} styles={model.styles} imageUrls={{}} zoom={1} onSelectCell={onSelectCell} />)

    fireEvent.click(screen.getByText('Quarter'))

    expect(onSelectCell).toHaveBeenCalledWith<[SelectedCellInfo]>({
      address: 'A2',
      cell: expect.objectContaining({ text: 'Quarter' })
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
      cell: expect.objectContaining({ text: '2026 Sales Summary' })
    })
  })

  it('clears the selection (calls back with null) on Escape', () => {
    const onSelectCell = vi.fn()
    render(<XlsxGrid sheet={salesSheet} styles={model.styles} imageUrls={{}} zoom={1} onSelectCell={onSelectCell} />)

    fireEvent.click(screen.getByText('Quarter'))
    onSelectCell.mockClear()

    fireEvent.keyDown(screen.getByTestId('xlsx-grid-scroll'), { key: 'Escape' })
    expect(onSelectCell).toHaveBeenCalledWith(null)
  })
})

describe('XlsxGrid — keyboard selection', () => {
  beforeEach(() => {
    showHeaderRange()
  })

  it('lands on A1 on the first arrow key when nothing is selected', () => {
    const onSelectCell = vi.fn()
    render(<XlsxGrid sheet={salesSheet} styles={model.styles} imageUrls={{}} zoom={1} onSelectCell={onSelectCell} />)

    fireEvent.keyDown(screen.getByTestId('xlsx-grid-scroll'), { key: 'ArrowDown' })
    expect(onSelectCell).toHaveBeenLastCalledWith(expect.objectContaining({ address: 'A1' }))
  })

  it('moves the selection with the arrow keys and reports each target cell', () => {
    const onSelectCell = vi.fn()
    render(<XlsxGrid sheet={salesSheet} styles={model.styles} imageUrls={{}} zoom={1} onSelectCell={onSelectCell} />)
    const scroll = screen.getByTestId('xlsx-grid-scroll')

    fireEvent.keyDown(scroll, { key: 'ArrowDown' }) // → A1 (initial landing)
    // A1 is a merge master (rows 1, cols 1-4); ArrowDown must clear the whole merge to row 2.
    fireEvent.keyDown(scroll, { key: 'ArrowDown' })
    expect(onSelectCell).toHaveBeenLastCalledWith(expect.objectContaining({ address: 'A2' }))
    fireEvent.keyDown(scroll, { key: 'ArrowRight' })
    expect(onSelectCell).toHaveBeenLastCalledWith(expect.objectContaining({ address: 'B2' }))
  })

  it('scrolls the moved-to cell into view (virtualized cells may be unmounted)', () => {
    render(<XlsxGrid sheet={salesSheet} styles={model.styles} imageUrls={{}} zoom={1} />)
    const scroll = screen.getByTestId('xlsx-grid-scroll')

    fireEvent.keyDown(scroll, { key: 'ArrowDown' }) // → A1
    fireEvent.keyDown(scroll, { key: 'ArrowDown' }) // → A2 (row index 1, col index 0)
    expect(mocks.rowScrollToIndex).toHaveBeenLastCalledWith(1)
    expect(mocks.colScrollToIndex).toHaveBeenLastCalledWith(0)
  })

  it('does not move past the top/left edge', () => {
    const onSelectCell = vi.fn()
    render(<XlsxGrid sheet={salesSheet} styles={model.styles} imageUrls={{}} zoom={1} onSelectCell={onSelectCell} />)
    const scroll = screen.getByTestId('xlsx-grid-scroll')

    fireEvent.keyDown(scroll, { key: 'ArrowDown' }) // → A1
    fireEvent.keyDown(scroll, { key: 'ArrowUp' }) // clamp at row 1
    fireEvent.keyDown(scroll, { key: 'ArrowLeft' }) // clamp at col 1
    expect(onSelectCell).toHaveBeenLastCalledWith(expect.objectContaining({ address: 'A1' }))
  })

  it('selects the current cursor cell on Enter', () => {
    const onSelectCell = vi.fn()
    render(<XlsxGrid sheet={salesSheet} styles={model.styles} imageUrls={{}} zoom={1} onSelectCell={onSelectCell} />)
    const scroll = screen.getByTestId('xlsx-grid-scroll')

    fireEvent.keyDown(scroll, { key: 'ArrowDown' }) // → A1
    fireEvent.keyDown(scroll, { key: 'ArrowDown' }) // → A2
    onSelectCell.mockClear()
    fireEvent.keyDown(scroll, { key: 'Enter' })
    expect(onSelectCell).toHaveBeenLastCalledWith(expect.objectContaining({ address: 'A2' }))
  })
})

describe('XlsxGrid — grid semantics', () => {
  beforeEach(() => {
    showHeaderRange()
  })

  it('exposes the focusable scroll container as a grid with row/col counts', () => {
    render(<XlsxGrid sheet={salesSheet} styles={model.styles} imageUrls={{}} zoom={1} />)
    const grid = screen.getByRole('grid')
    expect(grid).toHaveAttribute('tabindex', '0')
    expect(grid).toHaveAttribute('aria-rowcount')
    expect(grid).toHaveAttribute('aria-colcount')
  })

  it('wraps cells in rows and exposes 1-based row/col indices on gridcells', () => {
    render(<XlsxGrid sheet={salesSheet} styles={model.styles} imageUrls={{}} zoom={1} />)
    const quarterCell = screen.getByText('Quarter').closest('[role="gridcell"]') as HTMLElement
    // A2 → col index 1, inside row index 2.
    expect(quarterCell).toHaveAttribute('aria-colindex', '1')
    expect(quarterCell.closest('[role="row"]')).toHaveAttribute('aria-rowindex', '2')
  })
})

describe('XlsxGrid — selected cell overlay', () => {
  beforeEach(() => {
    showHeaderRange()
  })

  it('shows an absolutely positioned overlay with the full text when a cell is clicked', () => {
    render(<XlsxGrid sheet={salesSheet} styles={model.styles} imageUrls={{}} zoom={1} />)

    expect(screen.queryByTestId('xlsx-grid-selected-overlay')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Quarter'))

    const overlay = screen.getByTestId('xlsx-grid-selected-overlay')
    expect(overlay).toHaveTextContent('Quarter')
    // A2 rect: col A at x=0 (110px wide), row 2 at y=36 (20px tall). The overlay is at least the
    // cell rect and absolutely positioned — it overlays neighbours instead of pushing the layout.
    expect(overlay).toHaveStyle({
      position: 'absolute',
      top: '36px',
      left: '0px',
      minWidth: '110px',
      minHeight: '20px'
    })
  })

  it('covers the whole merge rect when the selection is a merge master', () => {
    showTitleMergeRange()
    const { container } = render(<XlsxGrid sheet={salesSheet} styles={model.styles} imageUrls={{}} zoom={1} />)
    setScrollViewport(container)

    fireEvent.click(screen.getByTestId('xlsx-grid-merge-cell'))

    const overlay = screen.getByTestId('xlsx-grid-selected-overlay')
    expect(overlay).toHaveTextContent('2026 Sales Summary')
    expect(overlay).toHaveStyle({ minWidth: '302px', minHeight: '36px' })
  })

  it('removes the overlay when the selection is cleared with Escape', () => {
    render(<XlsxGrid sheet={salesSheet} styles={model.styles} imageUrls={{}} zoom={1} />)

    fireEvent.click(screen.getByText('Quarter'))
    expect(screen.getByTestId('xlsx-grid-selected-overlay')).toBeInTheDocument()

    fireEvent.keyDown(screen.getByTestId('xlsx-grid-scroll'), { key: 'Escape' })
    expect(screen.queryByTestId('xlsx-grid-selected-overlay')).not.toBeInTheDocument()
  })
})

describe('XlsxGrid — floating layer', () => {
  it('renders a floating image at its zoom=1 rect and lets the transform layer scale it', () => {
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
    // floatingImages[0].rect = { x: 340, y: 44, width: 160, height: 90 } stays unscaled;
    // the ancestor zoom layer's transform applies the visual scaling.
    expect(img).toHaveStyle({ top: '44px', left: '340px', width: '160px', height: '90px' })
    expect(screen.getByTestId('xlsx-grid-zoom-layer')).toHaveStyle({ transform: 'scale(2)' })
  })

  it('renders one image per anchor when the same imageId is reused, without a duplicate React key', () => {
    setRangeFromCounts(
      [0],
      [0],
      () => 20,
      () => 64,
      () => 0,
      () => 0
    )
    // parseWorkbook deduplicates image data, so the same imageId can back multiple anchors. Each placement must
    // still render, and the keys must be unique (a duplicate key warning would signal a reconciliation hazard).
    const reusedImageSheet: SheetRenderModel = {
      ...salesSheet,
      floatingImages: [
        { rect: { x: 10, y: 10, width: 80, height: 60 }, imageId: 1 },
        { rect: { x: 200, y: 120, width: 80, height: 60 }, imageId: 1 }
      ]
    }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<XlsxGrid sheet={reusedImageSheet} styles={model.styles} imageUrls={{ 1: 'blob:mock-url' }} zoom={1} />)

    expect(screen.getAllByTestId('xlsx-grid-floating-image')).toHaveLength(2)
    expect(consoleError.mock.calls.some((call) => String(call[0]).includes('same key'))).toBe(false)
    consoleError.mockRestore()
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
    const renderChart = vi.fn((chart: ChartModel, container: HTMLElement) => {
      void chart
      void container
      return dispose
    })

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

    expect(screen.getByText('scatterChart')).toBeInTheDocument()
    expect(screen.getByText('scatterChart').closest('[data-testid="xlsx-grid-chart"]')?.firstElementChild).toHaveClass(
      'border-dashed'
    )
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
    expect(screen.getByTestId('xlsx-grid-chart').firstElementChild).toHaveClass('border-dashed')
  })
})
