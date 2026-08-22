import { SELECTION_EXCERPT_MAX_LENGTH, type SelectionReference } from '@renderer/types/selectionReference'
import type { AbsoluteFilePath } from '@shared/types/file'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockWorkbookModel } from '../mockModel'
import type { ChartModel } from '../renderModel'
import SpreadsheetFilePreview from '../SpreadsheetFilePreview'
import type { XlsxWorkbookState } from '../useXlsxWorkbook'
import type { XlsxGridProps } from '../XlsxGrid'

const mocks = vi.hoisted(() => ({
  workbookState: { status: 'idle' } as unknown,
  useXlsxWorkbookCalls: [] as Array<{ filePath: string; refreshKey: number; sourceSize?: number }>,
  translationCalls: [] as Array<{ key: string; options?: Record<string, unknown> }>,
  gridProps: [] as unknown[],
  rangeSelection: { range: 'A2:D4', rect: { top: 2, left: 1, bottom: 4, right: 4 } },
  chartRendererRender: vi.fn(() => () => {}),
  chartRendererModuleLoadCount: 0,
  chartRendererModuleShouldReject: false,
  createObjectURL: vi.fn(),
  revokeObjectURL: vi.fn(),
  logger: {
    error: vi.fn()
  }
}))

vi.mock('../useXlsxWorkbook', () => ({
  XLSX_PREVIEW_MAX_SIZE_BYTES: 20 * 1024 * 1024,
  useXlsxWorkbook: (filePath: string, refreshKey: number, sourceSize?: number) => {
    mocks.useXlsxWorkbookCalls.push({ filePath, refreshKey, sourceSize })
    return mocks.workbookState
  }
}))

/** Single cells the mocked grid can report, as (range -> sparse cell key, 1-based rect). */
const SELECTABLE_CELLS = {
  B6: { key: '6:2', rect: { top: 6, left: 2, bottom: 6, right: 2 } },
  B9: { key: '9:2', rect: { top: 9, left: 2, bottom: 9, right: 2 } },
  A3: { key: '3:1', rect: { top: 3, left: 1, bottom: 3, right: 1 } }
} as const

/** What the mocked grid's range button reports by default: the header block plus its first two data rows. */
const SELECTABLE_RANGE = { range: 'A2:D4', rect: { top: 2, left: 1, bottom: 4, right: 4 } }

vi.mock('../XlsxGrid', () => ({
  default: (props: {
    sheet: { name: string; cells: Record<string, unknown> }
    zoom: number
    onSelectCell?: (info: unknown) => void
    renderChart?: (chart: unknown, container: HTMLElement) => () => void
  }) => {
    mocks.gridProps.push(props)
    const selectCell = (range: keyof typeof SELECTABLE_CELLS) =>
      props.onSelectCell?.({
        range,
        rect: SELECTABLE_CELLS[range].rect,
        cell: props.sheet.cells[SELECTABLE_CELLS[range].key] ?? null
      })
    return (
      <div
        data-testid="xlsx-grid"
        data-sheet-name={props.sheet.name}
        data-zoom={props.zoom}
        data-has-render-chart={String(Boolean(props.renderChart))}>
        <button type="button" data-testid="grid-select-b6" onClick={() => selectCell('B6')}>
          select B6
        </button>
        <button type="button" data-testid="grid-select-b9" onClick={() => selectCell('B9')}>
          select B9
        </button>
        <button type="button" data-testid="grid-select-a3" onClick={() => selectCell('A3')}>
          select A3
        </button>
        <button
          type="button"
          data-testid="grid-select-range"
          onClick={() => props.onSelectCell?.({ ...mocks.rangeSelection, cell: null })}>
          select range
        </button>
        <button type="button" data-testid="grid-clear-selection" onClick={() => props.onSelectCell?.(null)}>
          clear
        </button>
      </div>
    )
  }
}))

vi.mock('../charts/EchartsChartRenderer', () => {
  mocks.chartRendererModuleLoadCount += 1
  if (mocks.chartRendererModuleShouldReject) {
    throw new Error('chart renderer chunk failed')
  }
  return {
    echartsChartRenderer: { render: mocks.chartRendererRender }
  }
})

vi.mock('@logger', () => ({
  loggerService: { withContext: () => mocks.logger }
}))

vi.mock('@cherrystudio/ui', async () => {
  const React = await import('react')
  const TabsContext = React.createContext<{ value?: string; onValueChange?: (v: string) => void }>({})
  return {
    Button: ({ children, ...props }: PropsWithChildren<React.ComponentPropsWithoutRef<'button'>>) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    EmptyState: ({ title, description }: { title: string; description?: string }) => (
      <div data-testid="empty-state">
        <span>{title}</span>
        <span>{description}</span>
      </div>
    ),
    Scrollbar: ({ children, ...props }: PropsWithChildren<React.ComponentPropsWithoutRef<'div'>>) => (
      <div {...props}>{children}</div>
    ),
    Tooltip: ({ children }: PropsWithChildren<{ content?: string; delay?: number }>) => <>{children}</>,
    Tabs: ({
      value,
      onValueChange,
      children
    }: PropsWithChildren<{
      value?: string
      onValueChange?: (v: string) => void
      variant?: string
      className?: string
    }>) => <TabsContext value={{ value, onValueChange }}>{children}</TabsContext>,
    TabsList: ({ children, ...props }: PropsWithChildren<React.ComponentPropsWithoutRef<'div'>>) => (
      <div role="tablist" {...props}>
        {children}
      </div>
    ),
    TabsTrigger: ({
      value,
      children,
      ...props
    }: PropsWithChildren<{ value: string } & React.ComponentPropsWithoutRef<'button'>>) => {
      const ctx = React.use(TabsContext)
      return (
        <button
          type="button"
          role="tab"
          aria-selected={ctx.value === value}
          onClick={() => ctx.onValueChange?.(value)}
          {...props}>
          {children}
        </button>
      )
    }
  }
})

vi.mock('@cherrystudio/ui/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' ')
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      mocks.translationCalls.push({ key, options })
      return key
    }
  })
}))

const setWorkbookState = (state: XlsxWorkbookState) => {
  mocks.workbookState = state
}

const lastGridProps = () => {
  const props = mocks.gridProps.at(-1)
  if (!props) throw new Error('Expected XlsxGrid to have rendered')
  return props as XlsxGridProps
}

/** Remove charts from the mock model so tests unrelated to chart lazy loading do not trigger act warnings. */
const modelWithoutCharts = () => {
  const model = createMockWorkbookModel()
  for (const sheet of model.sheets) sheet.charts = []
  return model
}

const renderPanel = (size = 1024, onSelectionReference?: (reference: SelectionReference | null) => void) =>
  render(
    <SpreadsheetFilePreview
      filePath={'/tmp/workspace/book.xlsx' as AbsoluteFilePath}
      fileName="book.xlsx"
      metadata={{ size, modifiedAt: 1 }}
      refreshKey={0}
      onSelectionReference={onSelectionReference}
    />
  )

describe('SpreadsheetFilePreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useXlsxWorkbookCalls.length = 0
    mocks.translationCalls.length = 0
    mocks.gridProps.length = 0
    mocks.rangeSelection = SELECTABLE_RANGE
    mocks.chartRendererRender.mockImplementation(() => () => {})
    mocks.chartRendererModuleShouldReject = false
    mocks.createObjectURL.mockReturnValue('blob:xlsx-image')
    setWorkbookState({ status: 'loading' })
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: mocks.createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: mocks.revokeObjectURL })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the loading state while parsing', () => {
    setWorkbookState({ status: 'loading' })

    renderPanel()

    expect(screen.getByRole('status')).toHaveTextContent('file_preview.loading')
    expect(screen.queryByTestId('xlsx-grid')).not.toBeInTheDocument()
  })

  it('renders the error state with a translated description, not the raw technical message', () => {
    setWorkbookState({ status: 'error', message: 'not an xlsx' })

    renderPanel()

    expect(screen.getByTestId('empty-state')).toHaveTextContent('file_preview.load_error.title')
    // The raw worker message is logged, not shown; the UI uses a translated, generic description.
    expect(screen.getByTestId('empty-state')).toHaveTextContent('xlsx_preview.error.description')
    expect(screen.getByTestId('empty-state')).not.toHaveTextContent('not an xlsx')
  })

  it('renders the oversize state with the size-limit message', () => {
    setWorkbookState({ status: 'oversize', sizeBytes: 25 * 1024 * 1024 })

    renderPanel()

    expect(screen.getByTestId('empty-state')).toHaveTextContent('xlsx_preview.too_large.title')
    expect(screen.getByTestId('empty-state')).toHaveTextContent('xlsx_preview.too_large.description')
    expect(mocks.translationCalls).toContainEqual({
      key: 'xlsx_preview.too_large.description',
      options: { size: '25.0 MB', limit: '20.0 MB' }
    })
  })

  it('forwards the preflighted metadata size to the workbook hook', () => {
    setWorkbookState({ status: 'loading' })

    renderPanel(4096)

    expect(mocks.useXlsxWorkbookCalls.at(-1)).toEqual({
      filePath: '/tmp/workspace/book.xlsx',
      refreshKey: 0,
      sourceSize: 4096
    })
  })

  it('renders the grid and visible sheet tabs when ready, with no status text until a cell is selected', () => {
    setWorkbookState({ status: 'ready', model: modelWithoutCharts() })

    renderPanel()

    expect(screen.getByTestId('spreadsheet-file-preview')).toBeInTheDocument()
    expect(screen.getByTestId('xlsx-grid')).toHaveAttribute('data-sheet-name', 'Sales')
    expect(screen.getByRole('tab', { name: 'Sales' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'false')
    // Hidden sheets get no tab.
    expect(screen.queryByRole('tab', { name: 'HiddenSheet' })).not.toBeInTheDocument()
    // No selection → no status text (the sheet tabs already show the active sheet).
    expect(screen.queryByTestId('xlsx-preview-status-bar')).not.toBeInTheDocument()
  })

  it('falls back to the first sheet when every sheet is hidden', () => {
    const model = modelWithoutCharts()
    for (const sheet of model.sheets) sheet.hidden = true
    setWorkbookState({ status: 'ready', model })

    renderPanel()

    expect(screen.getByTestId('xlsx-grid')).toHaveAttribute('data-sheet-name', 'Sales')
    expect(screen.getByRole('tab', { name: 'Sales' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Notes' })).not.toBeInTheDocument()
  })

  it('switches sheets via the tabs and clears the selection', () => {
    setWorkbookState({ status: 'ready', model: modelWithoutCharts() })

    renderPanel()

    fireEvent.click(screen.getByTestId('grid-select-b6'))
    expect(screen.getByTestId('xlsx-preview-status-bar')).toHaveTextContent('B6')

    fireEvent.click(screen.getByRole('tab', { name: 'Notes' }))

    expect(screen.getByTestId('xlsx-grid')).toHaveAttribute('data-sheet-name', 'Notes')
    expect(screen.getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true')
    // Selection was cleared by the sheet switch, so the status text disappears.
    expect(screen.queryByTestId('xlsx-preview-status-bar')).not.toBeInTheDocument()
  })

  it('shows the formula source for a selected formula cell', () => {
    setWorkbookState({ status: 'ready', model: modelWithoutCharts() })

    renderPanel()

    fireEvent.click(screen.getByTestId('grid-select-b6'))

    const statusBar = screen.getByTestId('xlsx-preview-status-bar')
    expect(statusBar).toHaveTextContent('B6 = SUM(B3:B5)')
    expect(statusBar).toHaveClass('selectable', 'select-text', 'cursor-text')
    expect(screen.queryByText('xlsx_preview.formula_not_evaluated')).not.toBeInTheDocument()
  })

  it('adds the unevaluated hint for a selected unevaluated formula cell', () => {
    setWorkbookState({ status: 'ready', model: modelWithoutCharts() })

    renderPanel()

    fireEvent.click(screen.getByTestId('grid-select-b9'))

    expect(screen.getByTestId('xlsx-preview-status-bar')).toHaveTextContent('B9 = FOOBAR(B3:B5)')
    expect(screen.getByText('xlsx_preview.formula_not_evaluated')).toBeInTheDocument()
  })

  it('shows address plus cell text for a selected plain cell', () => {
    setWorkbookState({ status: 'ready', model: modelWithoutCharts() })

    renderPanel()

    fireEvent.click(screen.getByTestId('grid-select-a3'))

    expect(screen.getByTestId('xlsx-preview-status-bar')).toHaveTextContent('A3 Q1')
  })

  it('steps through the zoom levels without a reset control', () => {
    setWorkbookState({ status: 'ready', model: modelWithoutCharts() })

    renderPanel()

    expect(screen.getByTestId('xlsx-preview-zoom-value')).toHaveTextContent('100%')

    fireEvent.click(screen.getByRole('button', { name: 'preview.zoom_in' }))
    expect(screen.getByTestId('xlsx-preview-zoom-value')).toHaveTextContent('125%')
    expect(screen.getByTestId('xlsx-grid')).toHaveAttribute('data-zoom', '1.25')

    fireEvent.click(screen.getByRole('button', { name: 'preview.zoom_out' }))
    fireEvent.click(screen.getByRole('button', { name: 'preview.zoom_out' }))
    expect(screen.getByTestId('xlsx-preview-zoom-value')).toHaveTextContent('75%')
    expect(screen.getByTestId('xlsx-grid')).toHaveAttribute('data-zoom', '0.75')

    // Zoom reset lives nowhere anymore — refreshing the preview restores the default.
    expect(screen.queryByRole('button', { name: 'preview.reset' })).not.toBeInTheDocument()
  })

  it('creates image object URLs when ready and revokes them on unmount', () => {
    setWorkbookState({ status: 'ready', model: modelWithoutCharts() })

    const { unmount } = renderPanel()

    expect(mocks.createObjectURL).toHaveBeenCalledTimes(1)
    expect(lastGridProps().imageUrls).toEqual({ 1: 'blob:xlsx-image' })
    expect(mocks.revokeObjectURL).not.toHaveBeenCalled()

    unmount()

    expect(mocks.revokeObjectURL).toHaveBeenCalledWith('blob:xlsx-image')
  })

  it('logs and keeps chart rendering disabled when the chart renderer chunk fails', async () => {
    mocks.chartRendererModuleShouldReject = true
    setWorkbookState({ status: 'ready', model: createMockWorkbookModel() })

    renderPanel()

    await waitFor(() =>
      expect(mocks.logger.error).toHaveBeenCalledWith('Failed to load xlsx chart renderer', expect.any(Error))
    )
    expect(screen.getByTestId('xlsx-grid')).toHaveAttribute('data-has-render-chart', 'false')
  })

  it('lazily loads the echarts renderer once a sheet has charts and wires renderChart into the grid', async () => {
    setWorkbookState({ status: 'ready', model: createMockWorkbookModel() })

    renderPanel()

    await waitFor(() => expect(screen.getByTestId('xlsx-grid')).toHaveAttribute('data-has-render-chart', 'true'))

    const container = document.createElement('div')
    const chart = { type: 'bar' } as ChartModel
    lastGridProps().renderChart?.(chart, container)
    expect(mocks.chartRendererRender).toHaveBeenCalledWith(chart, container)
  })

  it('does not wire renderChart for models without charts', () => {
    setWorkbookState({ status: 'ready', model: modelWithoutCharts() })

    renderPanel()

    expect(screen.getByTestId('xlsx-grid')).toHaveAttribute('data-has-render-chart', 'false')
  })

  it('shows the range in the status bar when the selection spans more than one cell', () => {
    setWorkbookState({ status: 'ready', model: modelWithoutCharts() })

    renderPanel()

    fireEvent.click(screen.getByTestId('grid-select-range'))

    expect(screen.getByTestId('xlsx-preview-status-bar')).toHaveTextContent('A2:D4')
  })

  it('reports a selected range as an xlsx anchor with the range text as its excerpt', () => {
    setWorkbookState({ status: 'ready', model: modelWithoutCharts() })
    const onSelectionReference = vi.fn()

    renderPanel(1024, onSelectionReference)
    fireEvent.click(screen.getByTestId('grid-select-range'))

    expect(onSelectionReference).toHaveBeenLastCalledWith<[SelectionReference]>({
      path: '/tmp/workspace/book.xlsx' as AbsoluteFilePath,
      anchor: { format: 'xlsx', sheet: 'Sales', range: 'A2:D4' },
      // A2:D4 read row by row. Trailing empty cells of the short last row collapse away with the tabs.
      excerpt:
        'Quarter Sales Date Notes Q1 1,250.00 2026-01-15 ' +
        'Holiday campaign boosted demand, with channel restocking concentrated in late January. Q2 980.50',
      fileStamp: { size: 1024, mtimeMs: 1 }
    })
  })

  it('anchors a single-cell selection at that cell', () => {
    setWorkbookState({ status: 'ready', model: modelWithoutCharts() })
    const onSelectionReference = vi.fn()

    renderPanel(1024, onSelectionReference)
    fireEvent.click(screen.getByTestId('grid-select-a3'))

    expect(onSelectionReference).toHaveBeenLastCalledWith(
      expect.objectContaining({
        anchor: { format: 'xlsx', sheet: 'Sales', range: 'A3' },
        excerpt: 'Q1'
      })
    )
  })

  it('reports null when the selection is cleared and when the sheet changes', () => {
    setWorkbookState({ status: 'ready', model: modelWithoutCharts() })
    const onSelectionReference = vi.fn()

    renderPanel(1024, onSelectionReference)

    fireEvent.click(screen.getByTestId('grid-select-a3'))
    fireEvent.click(screen.getByTestId('grid-clear-selection'))
    expect(onSelectionReference).toHaveBeenLastCalledWith(null)

    fireEvent.click(screen.getByTestId('grid-select-a3'))
    expect(onSelectionReference).toHaveBeenLastCalledWith(expect.objectContaining({ anchor: expect.anything() }))

    // Switching sheets invalidates the anchor, since the range is only meaningful inside its own sheet.
    fireEvent.click(screen.getByRole('tab', { name: 'Notes' }))
    expect(onSelectionReference).toHaveBeenLastCalledWith(null)
    // And never re-labels the old range as belonging to the sheet just switched to, not even for one commit.
    const anchors = onSelectionReference.mock.calls.map(
      ([reference]) => (reference as SelectionReference | null)?.anchor
    )
    expect(anchors).not.toContainEqual({ format: 'xlsx', sheet: 'Notes', range: 'A3' })
  })

  it('keeps the text of a range whose leading cells are blank', () => {
    const model = modelWithoutCharts()
    const sheet = model.sheets[0]
    // A block of empty cells far larger than the character budget, with real text after it. The separators
    // around blank cells collapse during normalization, so charging the budget for them would truncate the
    // scan before reaching the text and leave an empty excerpt.
    sheet.rowCount = 5000
    sheet.colCount = 1
    sheet.cells = { '4001:1': { text: 'text after the blanks', styleId: 0 } }
    mocks.rangeSelection = { range: 'A1:A5000', rect: { top: 1, left: 1, bottom: 5000, right: 1 } }
    setWorkbookState({ status: 'ready', model })
    const onSelectionReference = vi.fn()

    renderPanel(1024, onSelectionReference)
    fireEvent.click(screen.getByTestId('grid-select-range'))

    const reference = onSelectionReference.mock.lastCall?.[0] as SelectionReference
    expect(reference.excerpt).toBe('text after the blanks')
  })

  it('emits a merged range once, at its master, instead of repeating it per covered cell', () => {
    const model = modelWithoutCharts()
    const sheet = model.sheets[0]
    sheet.rowCount = 2
    sheet.colCount = 3
    // ExcelJS reports a merged range's value through every cell it covers, so the sparse table holds the
    // master's text at all four coordinates of A1:B2.
    sheet.cells = {
      '1:1': { text: 'merged title', styleId: 0 },
      '1:2': { text: 'merged title', styleId: 0 },
      '2:1': { text: 'merged title', styleId: 0 },
      '2:2': { text: 'merged title', styleId: 0 },
      '1:3': { text: 'tail', styleId: 0 }
    }
    sheet.merges = [{ top: 1, left: 1, bottom: 2, right: 2 }]
    mocks.rangeSelection = { range: 'A1:C2', rect: { top: 1, left: 1, bottom: 2, right: 3 } }
    setWorkbookState({ status: 'ready', model })
    const onSelectionReference = vi.fn()

    renderPanel(1024, onSelectionReference)
    fireEvent.click(screen.getByTestId('grid-select-range'))

    const reference = onSelectionReference.mock.lastCall?.[0] as SelectionReference
    expect(reference.excerpt.match(/merged title/g)).toHaveLength(1)
    expect(reference.excerpt).toBe('merged title tail')
  })

  it('bounds the excerpt scan for a whole-sheet selection instead of walking every empty coordinate', () => {
    const model = modelWithoutCharts()
    // A "select all" on a large sheet: the rect is dense (100M coordinates) even though the cell table is sparse.
    model.sheets[0].rowCount = 200_000
    model.sheets[0].colCount = 500
    mocks.rangeSelection = { range: 'A1:SF200000', rect: { top: 1, left: 1, bottom: 200_000, right: 500 } }
    setWorkbookState({ status: 'ready', model })
    const onSelectionReference = vi.fn()

    renderPanel(1024, onSelectionReference)
    const startedAt = performance.now()
    fireEvent.click(screen.getByTestId('grid-select-range'))
    const elapsed = performance.now() - startedAt

    const reference = onSelectionReference.mock.lastCall?.[0] as SelectionReference
    expect(reference.excerpt).toContain('2026 Sales Summary')
    expect(reference.excerpt.length).toBeLessThanOrEqual(SELECTION_EXCERPT_MAX_LENGTH)
    // Building the whole text before truncating would take minutes here; the scan must stop at the budget.
    expect(elapsed).toBeLessThan(2000)
  })

  it('forwards filePath and refreshKey to useXlsxWorkbook', () => {
    setWorkbookState({ status: 'loading' })

    renderPanel()

    expect(mocks.useXlsxWorkbookCalls.at(-1)).toEqual({
      filePath: '/tmp/workspace/book.xlsx',
      refreshKey: 0,
      sourceSize: 1024
    })
  })
})
