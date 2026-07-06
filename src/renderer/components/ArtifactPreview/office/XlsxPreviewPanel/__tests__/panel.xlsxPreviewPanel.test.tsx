import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockWorkbookModel } from '../mockModel'
import type { ChartModel } from '../renderModel'
import type { XlsxWorkbookState } from '../useXlsxWorkbook'
import type { XlsxGridProps } from '../XlsxGrid'
import XlsxPreviewPanel from '../XlsxPreviewPanel'

const mocks = vi.hoisted(() => ({
  workbookState: { status: 'idle' } as unknown,
  useXlsxWorkbookCalls: [] as Array<{ filePath: string; refreshKey: number; sourceSize?: number }>,
  gridProps: [] as unknown[],
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
  useXlsxWorkbook: (filePath: string, refreshKey: number, sourceSize?: number) => {
    mocks.useXlsxWorkbookCalls.push({ filePath, refreshKey, sourceSize })
    return mocks.workbookState
  }
}))

vi.mock('../XlsxGrid', () => ({
  default: (props: {
    sheet: { name: string; cells: Record<string, unknown> }
    zoom: number
    onSelectCell?: (info: unknown) => void
    renderChart?: (chart: unknown, container: HTMLElement) => () => void
  }) => {
    mocks.gridProps.push(props)
    const selectCell = (key: string) =>
      props.onSelectCell?.({
        address: key,
        cell: props.sheet.cells[key === 'B6' ? '6:2' : key === 'B9' ? '9:2' : '3:1'] ?? null
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

vi.mock('@renderer/components/chat/primitives', () => ({
  EmptyState: ({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) => (
    <div data-testid="empty-state">
      <span>{title}</span>
      <span>{description}</span>
      {actions}
    </div>
  ),
  LoadingState: ({ label }: { label?: string }) => <div data-testid="loading-state">{label}</div>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
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

const renderPanel = () =>
  render(<XlsxPreviewPanel filePath="/tmp/workspace/book.xlsx" fileName="book.xlsx" refreshKey={0} />)

describe('XlsxPreviewPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useXlsxWorkbookCalls.length = 0
    mocks.gridProps.length = 0
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

    expect(screen.getByTestId('loading-state')).toBeInTheDocument()
    expect(screen.queryByTestId('xlsx-grid')).not.toBeInTheDocument()
  })

  it('renders the error state with the parse failure message', () => {
    setWorkbookState({ status: 'error', message: 'not an xlsx' })

    renderPanel()

    expect(screen.getByTestId('empty-state')).toHaveTextContent('common.error')
    expect(screen.getByTestId('empty-state')).toHaveTextContent('not an xlsx')
  })

  it('renders the oversize state with the size-limit message', () => {
    setWorkbookState({ status: 'oversize', sizeBytes: 25 * 1024 * 1024 })

    renderPanel()

    expect(screen.getByTestId('empty-state')).toHaveTextContent('xlsx_preview.too_large.title')
    expect(screen.getByTestId('empty-state')).toHaveTextContent('xlsx_preview.too_large.description')
  })

  it('surfaces the actions slot in the oversize and error states', () => {
    const actions = <button type="button">Open externally</button>
    setWorkbookState({ status: 'oversize', sizeBytes: 25 * 1024 * 1024 })

    const { rerender } = render(
      <XlsxPreviewPanel filePath="/tmp/workspace/book.xlsx" fileName="book.xlsx" refreshKey={0} actions={actions} />
    )
    expect(screen.getByRole('button', { name: 'Open externally' })).toBeInTheDocument()

    setWorkbookState({ status: 'error', message: 'boom' })
    rerender(
      <XlsxPreviewPanel filePath="/tmp/workspace/book.xlsx" fileName="book.xlsx" refreshKey={0} actions={actions} />
    )
    expect(screen.getByRole('button', { name: 'Open externally' })).toBeInTheDocument()
  })

  it('forwards sourceSize to the workbook hook', () => {
    setWorkbookState({ status: 'loading' })

    render(
      <XlsxPreviewPanel filePath="/tmp/workspace/book.xlsx" fileName="book.xlsx" refreshKey={0} sourceSize={4096} />
    )

    expect(mocks.useXlsxWorkbookCalls.at(-1)).toEqual({
      filePath: '/tmp/workspace/book.xlsx',
      refreshKey: 0,
      sourceSize: 4096
    })
  })

  it('renders the grid and visible sheet tabs when ready, with no status text until a cell is selected', () => {
    setWorkbookState({ status: 'ready', model: modelWithoutCharts() })

    renderPanel()

    expect(screen.getByTestId('xlsx-preview-panel')).toBeInTheDocument()
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

    // Zoom reset lives nowhere anymore — the top toolbar refresh covers "back to default".
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

  it('forwards filePath and refreshKey to useXlsxWorkbook', () => {
    setWorkbookState({ status: 'loading' })

    renderPanel()

    expect(mocks.useXlsxWorkbookCalls.at(-1)).toEqual({ filePath: '/tmp/workspace/book.xlsx', refreshKey: 0 })
  })
})
