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
    }
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
  )
}))

vi.mock('../Markdown', () => ({
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

  // Test data factories
  const createTablePosition = (startLine = 1, endLine = 3) => ({
    start: { line: startLine, column: 1, offset: 0 },
    end: { line: endLine, column: 1, offset: 2 }
  })

  const defaultTableContent = `| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |`

  const defaultProps = {
    children: (
      <tbody>
        <tr>
          <td>Cell 1</td>
          <td>Cell 2</td>
        </tr>
      </tbody>
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
      expect(screen.getByText('Cell 1')).toBeInTheDocument()
      expect(screen.getByText('Cell 2')).toBeInTheDocument()
      expect(screen.getAllByTestId('tooltip')).toHaveLength(2)
    })

    it('should render with table-wrapper and table-toolbar classes', () => {
      const { container } = render(<Table {...defaultProps} />)

      expect(container.querySelector('.table-wrapper')).toBeInTheDocument()
      expect(container.querySelector('.table-toolbar')).toBeInTheDocument()
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
      const position = createTablePosition(1, 3)

      const result = extractTableMarkdown('test-block-1', position, defaultTableContent)

      expect(result).toBe(defaultTableContent)
    })

    it('should handle line range extraction correctly', () => {
      const multiLineContent = `Line 0
| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |
Line 4`
      const position = createTablePosition(2, 4) // Extract lines 2-4 (table part)

      const result = extractTableMarkdown('test-block-1', position, multiLineContent)

      expect(result).toBe(`| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |`)
    })

    it('should return empty string when blockId is empty', () => {
      const result = extractTableMarkdown('', createTablePosition())
      expect(result).toBe('')
    })

    it('should return empty string when position is null', () => {
      const result = extractTableMarkdown('test-block-1', null, defaultTableContent)
      expect(result).toBe('')
    })

    it('should return empty string when position is undefined', () => {
      const result = extractTableMarkdown('test-block-1', undefined, defaultTableContent)
      expect(result).toBe('')
    })

    it('should return empty string when markdown content is missing', () => {
      const result = extractTableMarkdown('test-block-1', createTablePosition())

      expect(result).toBe('')
    })

    it('should return empty string when markdown content is empty', () => {
      const result = extractTableMarkdown('test-block-1', createTablePosition(), '')

      expect(result).toBe('')
    })

    it('should handle boundary line numbers correctly', () => {
      const content = 'Line 1\nLine 2\nLine 3'
      const position = createTablePosition(1, 3)

      const result = extractTableMarkdown('test-block-1', position, content)

      expect(result).toBe('Line 1\nLine 2\nLine 3')
    })
  })

  describe('copy functionality', () => {
    it('should copy table content through provider action on button click', async () => {
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
