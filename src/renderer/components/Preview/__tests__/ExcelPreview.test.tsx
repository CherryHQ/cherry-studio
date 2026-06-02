import { act, render, screen, waitFor } from '@testing-library/react'
import { type IWorkbookData, LocaleType } from '@univerjs/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ExcelPreview from '../ExcelPreview'

const mocks = vi.hoisted(() => ({
  excelWorkbookView: vi.fn(),
  readWorkbookPreview: vi.fn(),
  t: vi.fn((key: string) => key)
}))

vi.mock('@renderer/components/chat', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">
      <span>{title}</span>
      <span>{description}</span>
    </div>
  ),
  LoadingState: ({ label }: { label: string }) => <div data-testid="loading-state">{label}</div>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mocks.t
  })
}))

vi.mock('@renderer/components/Excel', () => ({
  ExcelWorkbookView: (props: {
    ariaLabel?: string
    onError?: (error: Error) => void
    readOnly?: boolean
    tables?: unknown[]
    workbookData: IWorkbookData
  }) => {
    mocks.excelWorkbookView(props)

    return <div data-testid="excel-workbook-view" data-aria-label={props.ariaLabel} />
  }
}))

const makeWorkbookData = (overrides: Partial<IWorkbookData> = {}): IWorkbookData => ({
  id: 'workbook-1',
  name: 'report.xlsx',
  appVersion: '0.25.0',
  locale: LocaleType.EN_US,
  sheetOrder: ['sheet-1'],
  sheets: {
    'sheet-1': {
      cellData: {},
      id: 'sheet-1',
      name: 'Sheet1'
    }
  },
  styles: {},
  ...overrides
})

const workbookData = makeWorkbookData()
const tables = [
  {
    columns: [{ id: 'excel-table-sheet-1-Sales-column-1', displayName: 'Region' }],
    id: 'excel-table-sheet-1-Sales',
    name: 'Sales',
    range: { startRow: 0, startColumn: 0, endRow: 2, endColumn: 0 },
    sheetId: 'sheet-1'
  }
]

describe('ExcelPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readWorkbookPreview.mockResolvedValue({
      success: true,
      data: {
        diagnostics: [],
        fileName: 'report.xlsx',
        tables,
        workbookData
      }
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        excel: {
          readWorkbookPreview: mocks.readWorkbookPreview
        }
      }
    })
  })

  it('requests a workbook preview from main and renders the workbook view', async () => {
    render(<ExcelPreview filePath="/tmp/workspace/report.xlsx" fileName="report.xlsx" refreshKey={3} />)

    expect(screen.getByTestId('loading-state')).toHaveTextContent('common.loading')
    await waitFor(() => expect(screen.getByTestId('excel-workbook-view')).toBeInTheDocument())
    expect(mocks.readWorkbookPreview).toHaveBeenCalledWith({
      filePath: '/tmp/workspace/report.xlsx',
      fileName: 'report.xlsx'
    })
    expect(mocks.excelWorkbookView).toHaveBeenCalledWith(
      expect.objectContaining({
        ariaLabel: 'report.xlsx',
        readOnly: true,
        tables,
        workbookData
      })
    )
  })

  it('does not send fileName when the caller does not provide one', async () => {
    render(<ExcelPreview filePath="/tmp/workspace/report.xlsx" />)

    await waitFor(() => expect(screen.getByTestId('excel-workbook-view')).toBeInTheDocument())
    expect(mocks.readWorkbookPreview).toHaveBeenCalledWith({
      filePath: '/tmp/workspace/report.xlsx'
    })
    expect(mocks.excelWorkbookView).toHaveBeenCalledWith(
      expect.objectContaining({
        ariaLabel: '/tmp/workspace/report.xlsx'
      })
    )
  })

  it('re-requests the preview when refreshKey changes', async () => {
    const { rerender } = render(<ExcelPreview filePath="/tmp/workspace/report.xlsx" fileName="report.xlsx" />)

    await waitFor(() => expect(mocks.readWorkbookPreview).toHaveBeenCalledTimes(1))

    rerender(<ExcelPreview filePath="/tmp/workspace/report.xlsx" fileName="report.xlsx" refreshKey={1} />)

    await waitFor(() => expect(mocks.readWorkbookPreview).toHaveBeenCalledTimes(2))
  })

  it('renders an empty state for empty converted workbooks', async () => {
    mocks.readWorkbookPreview.mockResolvedValueOnce({
      success: true,
      data: {
        diagnostics: [],
        fileName: 'empty.xlsx',
        workbookData: makeWorkbookData({ id: 'empty', name: 'empty.xlsx', sheetOrder: [], sheets: {} })
      }
    })

    render(<ExcelPreview filePath="/tmp/workspace/empty.xlsx" fileName="empty.xlsx" />)

    await waitFor(() => expect(screen.getByTestId('empty-state')).toHaveTextContent('agent.preview_pane.empty.title'))
    expect(mocks.excelWorkbookView).not.toHaveBeenCalled()
  })

  it('renders an error state when main returns an error result', async () => {
    mocks.readWorkbookPreview.mockResolvedValueOnce({
      success: false,
      error: {
        code: 'excel_parse_error',
        message: 'parse failed'
      }
    })

    render(<ExcelPreview filePath="/tmp/workspace/broken.xlsx" fileName="broken.xlsx" />)

    await waitFor(() =>
      expect(screen.getByTestId('empty-state')).toHaveTextContent('agent.preview_pane.excel.errors.parse_failed')
    )
    expect(mocks.excelWorkbookView).not.toHaveBeenCalled()
  })

  it('renders workbook view without a preview warning when import diagnostics are returned', async () => {
    mocks.readWorkbookPreview.mockResolvedValueOnce({
      success: true,
      data: {
        diagnostics: [
          {
            code: 'unsupported_excel_images',
            count: 2,
            message: 'Images are not rendered in Excel preview yet.',
            severity: 'warning'
          }
        ],
        fileName: 'images.xlsx',
        workbookData
      }
    })

    render(<ExcelPreview filePath="/tmp/workspace/images.xlsx" fileName="images.xlsx" />)

    await waitFor(() => expect(screen.getByTestId('excel-workbook-view')).toBeInTheDocument())
    expect(screen.queryByTestId('excel-preview-alert')).not.toBeInTheDocument()
  })

  it('renders an error state when the workbook view reports an initialization failure', async () => {
    render(<ExcelPreview filePath="/tmp/workspace/report.xlsx" fileName="report.xlsx" />)

    await waitFor(() => expect(mocks.excelWorkbookView).toHaveBeenCalled())
    const latestProps = mocks.excelWorkbookView.mock.calls.at(-1)?.[0]
    expect(latestProps?.onError).toEqual(expect.any(Function))

    act(() => {
      latestProps?.onError?.(new Error('create failed'))
    })

    expect(screen.getByTestId('empty-state')).toHaveTextContent('agent.preview_pane.excel.errors.parse_failed')
  })
})
