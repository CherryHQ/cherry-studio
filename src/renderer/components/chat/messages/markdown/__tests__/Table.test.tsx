import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import Table, { extractTableMarkdown } from '../Table'

const mocks = vi.hoisted(() => {
  return {
    messageBlocksSelectors: {
      selectById: vi.fn()
    },
    messageListActions: {
      copyRichContent: vi.fn(),
      exportTableAsExcel: vi.fn(),
      notifySuccess: vi.fn(),
      notifyError: vi.fn()
    },
    markdownContext: {
      content: ''
    },
    logger: {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    },
    exportTableToExcel: vi.fn(),
    markdownBlockContext: { content: '' as string }
  }
})

// Mock dependencies
vi.mock('@renderer/components/Icons', () => ({
  CopyIcon: ({ size }: { size: number }) => <div data-testid="copy-icon" style={{ width: size, height: size }} />
}))

vi.mock('lucide-react', () => ({
  Check: ({ size }: { size: number }) => <div data-testid="check-icon" style={{ width: size, height: size }} />,
  FileSpreadsheet: ({ size }: { size: number }) => (
    <div data-testid="excel-icon" style={{ width: size, height: size }} />
  )
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => mocks.logger
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@cherrystudio/ui', () => ({
  Tooltip: ({ children, title, content }: any) => (
    <div data-testid="tooltip" title={content || title}>
      {children}
    </div>
  ),
  useMarkdownBlockContext: () => mocks.markdownContext
}))

vi.mock('../../MessageListProvider', () => ({
  useOptionalMessageListActions: () => mocks.messageListActions
}))

describe('Table', () => {
  beforeAll(() => {
    vi.stubGlobal('jest', {
      advanceTimersByTime: vi.advanceTimersByTime.bind(vi)
    })
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.markdownContext.content = defaultTableContent
    mocks.messageListActions.copyRichContent = vi.fn().mockResolvedValue(undefined)
    mocks.messageListActions.exportTableAsExcel = vi.fn().mockResolvedValue(true)
    mocks.messageListActions.notifySuccess = vi.fn()
    mocks.messageListActions.notifyError = vi.fn()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  // https://testing-library.com/docs/user-event/clipboard/
  const user = userEvent.setup({
    advanceTimers: vi.advanceTimersByTime.bind(vi),
    writeToClipboard: true
  })

  const createTablePosition = (startLine = 1, endLine = 3) => ({
    start: { line: startLine, column: 1, offset: 0 },
    end: { line: endLine, column: 1, offset: 2 }
  })

  const defaultTableContent = `| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |`

  const defaultProps = {
    children: (
      <>
        <thead>
          <tr>
            <th>Header 1</th>
            <th>Header 2</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Cell 1</td>
            <td>Cell 2</td>
          </tr>
        </tbody>
      </>
    ),
    blockId: 'test-block-1',
    node: { position: createTablePosition() }
  }

  const getCopyButton = () => screen.getByRole('button', { name: /common\.copy/i })
  const getExcelButton = () => screen.getByRole('button', { name: /common\.export\.excel/i })
  const getCopyIcon = () => screen.getByTestId('copy-icon')
  const getExcelIcon = () => screen.getByTestId('excel-icon')
  const getCheckIcon = () => screen.getByTestId('check-icon')
  const queryCheckIcon = () => screen.queryByTestId('check-icon')
  const queryCopyIcon = () => screen.queryByTestId('copy-icon')

  describe('rendering', () => {
    it('should render table with children and toolbar', () => {
      render(<Table {...defaultProps} />)

      expect(screen.getByRole('table')).toBeInTheDocument()
      expect(screen.getByText('Header 1')).toBeInTheDocument()
      expect(screen.getByText('Cell 1')).toBeInTheDocument()
      expect(screen.getByText('Cell 2')).toBeInTheDocument()
      expect(screen.getAllByTestId('tooltip')).toHaveLength(2)
    })

    it('should render with design-system table and toolbar classes', () => {
      const { container } = render(<Table {...defaultProps} />)

      const wrapper = container.querySelector('.table-wrapper')
      const scrollViewport = container.querySelector('.table-scroll-viewport')
      const table = screen.getByRole('table')
      const toolbar = container.querySelector('.table-toolbar')
      const copyButton = getCopyButton()

      expect(wrapper).toHaveClass('my-2', 'w-full', 'min-w-0', 'max-w-full', 'relative')
      expect(wrapper).not.toHaveClass('overflow-x-auto')
      expect(scrollViewport).toHaveClass('w-full', 'min-w-0', 'max-w-full', 'overflow-x-auto')
      expect(toolbar?.parentElement).toBe(wrapper)
      expect(toolbar).toHaveClass('absolute', 'top-2', 'end-2')
      expect(toolbar).not.toHaveClass('sticky')
      expect(table.className).toContain('[&&]:rounded-none')
      expect(table.className).toContain('[&&]:overflow-visible')
      expect(table.className).toContain('[&&]:min-w-160')
      expect(table.className).not.toContain('[&&]:min-w-max')
      expect(table.className).toContain('[&&_td]:wrap-break-word')
      expect(table.className).toContain('[&&_th]:wrap-break-word')
      expect(table.className).toContain('[&&_th]:bg-muted')
      expect(table.className).toContain('[&&_th]:font-semibold')
      expect(table.className).toContain('[&&_td]:bg-muted')
      expect(table.className).toContain('[&&_thead]:bg-transparent')
      expect(table.className).toContain('[&&_tbody]:bg-transparent')
      expect(table.className).toContain('[&&_tbody>tr]:border-0')
      expect(table.className).toContain('[&_td]:rounded-md')
      expect(table.style.border).toBe('0px')
      expect(table.style.borderRadius).toBe('0')
      expect(table.style.borderSpacing).toBe('var(--cs-size-5xs)')
      expect(table.style.margin).toBe('0px')
      expect(table.style.overflow).toBe('visible')
      expect(toolbar).toHaveClass('rounded-lg', 'border-border-subtle', 'bg-popover', 'shadow-md')
      expect(copyButton).toHaveClass('rounded-md', 'text-foreground-muted', 'hover:bg-ghost-hover')
    })

    it('should render copy button with correct tooltip', () => {
      render(<Table {...defaultProps} />)

      const tooltips = screen.getAllByTestId('tooltip')
      expect(tooltips[0]).toHaveAttribute('title', 'common.copy')
    })

    it('should render excel export button with correct tooltip', () => {
      render(<Table {...defaultProps} />)

      const tooltips = screen.getAllByTestId('tooltip')
      expect(tooltips[1]).toHaveAttribute('title', 'common.export.excel')
      expect(getExcelIcon()).toBeInTheDocument()
    })

    it('should match snapshot', () => {
      const { container } = render(<Table {...defaultProps} />)
      expect(container.firstChild).toMatchSnapshot()
    })
  })

  describe('extractTableMarkdown', () => {
    it('should extract table content from specified line range', () => {
      const result = extractTableMarkdown('test-block-1', createTablePosition(1, 3), defaultTableContent)
      expect(result).toBe(defaultTableContent)
    })

    it('should handle line range extraction correctly', () => {
      const multiLineContent = `Line 0
| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |
Line 4`

      const result = extractTableMarkdown('test-block-1', createTablePosition(2, 4), multiLineContent)

      expect(result).toBe(`| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |`)
    })

    it('should return empty string when position is null', () => {
      expect(extractTableMarkdown('test-block-1', null, defaultTableContent)).toBe('')
    })

    it('should return empty string when position is undefined', () => {
      expect(extractTableMarkdown('test-block-1', undefined, defaultTableContent)).toBe('')
    })

    it('should return empty string when markdownContent is missing', () => {
      expect(extractTableMarkdown('test-block-1', createTablePosition(), undefined)).toBe('')
    })

    it('should handle boundary line numbers correctly', () => {
      const result = extractTableMarkdown('test-block-1', createTablePosition(1, 3), 'Line 1\nLine 2\nLine 3')
      expect(result).toBe('Line 1\nLine 2\nLine 3')
    })
  })

  describe('copy functionality', () => {
    beforeEach(() => {
      mocks.markdownBlockContext.content = defaultTableContent
    })

    it('should copy table content to clipboard on button click', async () => {
      render(<Table {...defaultProps} />)

      const copyButton = getCopyButton()
      await user.click(copyButton)

      await waitFor(() => {
        expect(mocks.messageListActions.copyRichContent).toHaveBeenCalledWith(
          {
            plainText: defaultTableContent,
            html: expect.stringContaining('<table>')
          },
          { successMessage: 'message.copied' }
        )
        expect(getCheckIcon()).toBeInTheDocument()
        expect(queryCopyIcon()).not.toBeInTheDocument()
      })

      // Flush useTemporaryValue timer to avoid act() warning
      act(() => {
        vi.advanceTimersByTime(2000)
      })
    })

    it('should show check icon after successful copy', async () => {
      render(<Table {...defaultProps} />)

      // Initially shows copy icon
      expect(getCopyIcon()).toBeInTheDocument()

      const copyButton = getCopyButton()
      await user.click(copyButton)

      await waitFor(() => {
        expect(getCheckIcon()).toBeInTheDocument()
        expect(queryCopyIcon()).not.toBeInTheDocument()
      })

      // Flush useTemporaryValue timer to avoid act() warning
      act(() => {
        vi.advanceTimersByTime(2000)
      })
    })

    it('should reset to copy icon after 2 seconds', async () => {
      render(<Table {...defaultProps} />)

      const copyButton = getCopyButton()
      await user.click(copyButton)

      await waitFor(() => {
        expect(getCheckIcon()).toBeInTheDocument()
      })

      // Fast forward 2 seconds
      act(() => {
        vi.advanceTimersByTime(2000)
      })

      await waitFor(() => {
        expect(getCopyIcon()).toBeInTheDocument()
        expect(queryCheckIcon()).not.toBeInTheDocument()
      })
    })

    it('should show error toast when extractTableMarkdown returns empty string', async () => {
      mocks.markdownContext.content = ''

      render(<Table {...defaultProps} />)

      const copyButton = getCopyButton()
      await user.click(copyButton)

      await waitFor(() => {
        expect(mocks.messageListActions.notifyError).toHaveBeenCalledWith('message.error.table.invalid')
        expect(getCopyIcon()).toBeInTheDocument()
        expect(queryCheckIcon()).not.toBeInTheDocument()
      })
    })

    it('should show error notification when copy action fails', async () => {
      const copyError = new Error('Copy failed')
      mocks.messageListActions.copyRichContent.mockRejectedValueOnce(copyError)

      render(<Table {...defaultProps} />)

      const copyButton = getCopyButton()
      await user.click(copyButton)

      await waitFor(() => {
        expect(mocks.logger.error).toHaveBeenCalledWith('Failed to copy table to clipboard', { error: copyError })
        expect(mocks.messageListActions.notifyError).toHaveBeenCalledWith('message.copy.failed')
      })
    })
  })

  describe('excel export functionality', () => {
    beforeEach(() => {
      mocks.markdownBlockContext.content = defaultTableContent
      mocks.exportTableToExcel.mockResolvedValue(true)
      vi.clearAllMocks()
      mocks.markdownContext.content = defaultTableContent
      mocks.messageListActions.copyRichContent = vi.fn().mockResolvedValue(undefined)
      mocks.messageListActions.exportTableAsExcel = vi.fn().mockResolvedValue(true)
      mocks.messageListActions.notifySuccess = vi.fn()
      mocks.messageListActions.notifyError = vi.fn()
    })

    it('should export table to Excel on button click', async () => {
      render(<Table {...defaultProps} />)

      const excelButton = getExcelButton()
      await user.click(excelButton)

      await waitFor(() => {
        expect(mocks.messageListActions.exportTableAsExcel).toHaveBeenCalledWith(defaultTableContent)
      })
    })

    it('should show success toast after successful export', async () => {
      render(<Table {...defaultProps} />)

      const excelButton = getExcelButton()
      await user.click(excelButton)

      await waitFor(() => {
        expect(mocks.messageListActions.notifySuccess).toHaveBeenCalledWith('message.success.excel.export')
      })
    })

    it('should show error toast and log error on export failure', async () => {
      const exportError = new Error('Export failed')
      mocks.messageListActions.exportTableAsExcel.mockRejectedValueOnce(exportError)

      render(<Table {...defaultProps} />)

      const excelButton = getExcelButton()
      await user.click(excelButton)

      await waitFor(() => {
        expect(mocks.logger.error).toHaveBeenCalledWith('Failed to export table to Excel', { error: exportError })
        expect(mocks.messageListActions.notifyError).toHaveBeenCalledWith('message.error.excel.export')
      })
    })

    it('should show error toast when extractTableMarkdown returns empty string', async () => {
      mocks.markdownContext.content = ''

      render(<Table {...defaultProps} />)

      const excelButton = getExcelButton()
      await user.click(excelButton)

      await waitFor(() => {
        expect(mocks.messageListActions.notifyError).toHaveBeenCalledWith('message.error.table.invalid')
        expect(mocks.messageListActions.exportTableAsExcel).not.toHaveBeenCalled()
      })
    })

    it('should not show error toast when export returns false', async () => {
      mocks.messageListActions.exportTableAsExcel.mockResolvedValueOnce(false)

      render(<Table {...defaultProps} />)

      const excelButton = getExcelButton()
      await user.click(excelButton)

      await waitFor(() => {
        expect(mocks.messageListActions.exportTableAsExcel).toHaveBeenCalled()
        expect(mocks.messageListActions.notifySuccess).not.toHaveBeenCalled()
        expect(mocks.messageListActions.notifyError).not.toHaveBeenCalled()
      })
    })
  })

  describe('edge cases', () => {
    it('should hide toolbar when provider actions are unavailable', () => {
      mocks.messageListActions.copyRichContent = undefined as any
      mocks.messageListActions.exportTableAsExcel = undefined as any

      const { container } = render(<Table {...defaultProps} />)

      expect(container.querySelector('.table-toolbar')).not.toBeInTheDocument()
    })

    it('should work without blockId', () => {
      const propsWithoutBlockId = { ...defaultProps, blockId: undefined }

      expect(() => render(<Table {...propsWithoutBlockId} />)).not.toThrow()

      const copyButton = getCopyButton()
      expect(copyButton).toBeInTheDocument()
    })

    it('should work without node position', () => {
      const propsWithoutPosition = { ...defaultProps, node: undefined }

      expect(() => render(<Table {...propsWithoutPosition} />)).not.toThrow()

      const copyButton = getCopyButton()
      expect(copyButton).toBeInTheDocument()
    })
  })
})
