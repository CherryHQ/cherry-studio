import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import Table, { extractTableMarkdown } from '../Table'

const mocks = vi.hoisted(() => {
  return {
    store: {
      getState: vi.fn()
    },
    messageBlocksSelectors: {
      selectById: vi.fn()
    },
    windowMessage: {
      error: vi.fn()
    }
  }
})

// Mock dependencies
vi.mock('@renderer/store', () => ({
  __esModule: true,
  default: mocks.store
}))

vi.mock('@renderer/store/messageBlock', () => ({
  messageBlocksSelectors: mocks.messageBlocksSelectors
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('antd', () => ({
  Tooltip: ({ children, title }: any) => (
    <div data-testid="tooltip" title={title}>
      {children}
    </div>
  )
}))

Object.assign(window, {
  message: mocks.windowMessage
})

describe('Table', () => {
  beforeAll(() => {
    vi.stubGlobal('jest', {
      advanceTimersByTime: vi.advanceTimersByTime.bind(vi)
    })
  })

  beforeEach(() => {
    vi.clearAllMocks()
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
  const createMockBlock = (content: string = defaultTableContent) => ({
    id: 'test-block-1',
    content
  })

  const createTablePosition = (startLine = 1, endLine = 3) => ({
    start: { line: startLine },
    end: { line: endLine }
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
  const getCopyIcon = () => screen.getByTestId('copy-icon')
  const getCheckIcon = () => screen.getByTestId('check-icon')
  const queryCheckIcon = () => screen.queryByTestId('check-icon')
  const queryCopyIcon = () => screen.queryByTestId('copy-icon')

  describe('rendering', () => {
    it('should render table with children and toolbar', () => {
      render(<Table {...defaultProps} />)

      expect(screen.getByRole('table')).toBeInTheDocument()
      expect(screen.getByText('Cell 1')).toBeInTheDocument()
      expect(screen.getByText('Cell 2')).toBeInTheDocument()
      expect(screen.getByTestId('tooltip')).toBeInTheDocument()
    })

    it('should render with table-wrapper and table-toolbar classes', () => {
      const { container } = render(<Table {...defaultProps} />)

      expect(container.querySelector('.table-wrapper')).toBeInTheDocument()
      expect(container.querySelector('.table-toolbar')).toBeInTheDocument()
    })

    it('should render copy button with correct tooltip', () => {
      render(<Table {...defaultProps} />)

      const tooltip = screen.getByTestId('tooltip')
      expect(tooltip).toHaveAttribute('title', 'common.copy')
    })

    it('should match snapshot', () => {
      const { container } = render(<Table {...defaultProps} />)
      expect(container.firstChild).toMatchSnapshot()
    })
  })

  describe('extractTableMarkdown', () => {
    beforeEach(() => {
      mocks.store.getState.mockReturnValue({})
    })

    it('should extract table content from specified line range', () => {
      const block = createMockBlock()
      const position = createTablePosition(1, 3)
      mocks.messageBlocksSelectors.selectById.mockReturnValue(block)

      const result = extractTableMarkdown('test-block-1', position)

      expect(result).toBe(defaultTableContent)
      expect(mocks.messageBlocksSelectors.selectById).toHaveBeenCalledWith({}, 'test-block-1')
    })

    it('should handle line range extraction correctly', () => {
      const multiLineContent = `Line 0
| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |
Line 4`
      const block = createMockBlock(multiLineContent)
      const position = createTablePosition(2, 4) // Extract lines 2-4 (table part)
      mocks.messageBlocksSelectors.selectById.mockReturnValue(block)

      const result = extractTableMarkdown('test-block-1', position)

      expect(result).toBe(`| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |`)
    })

    it('should return empty string when blockId is empty', () => {
      const result = extractTableMarkdown('', createTablePosition())
      expect(result).toBe('')
      expect(mocks.messageBlocksSelectors.selectById).not.toHaveBeenCalled()
    })

    it('should return empty string when position is null', () => {
      const result = extractTableMarkdown('test-block-1', null)
      expect(result).toBe('')
      expect(mocks.messageBlocksSelectors.selectById).not.toHaveBeenCalled()
    })

    it('should return empty string when position is undefined', () => {
      const result = extractTableMarkdown('test-block-1', undefined)
      expect(result).toBe('')
      expect(mocks.messageBlocksSelectors.selectById).not.toHaveBeenCalled()
    })

    it('should return empty string when block does not exist', () => {
      mocks.messageBlocksSelectors.selectById.mockReturnValue(null)

      const result = extractTableMarkdown('non-existent-block', createTablePosition())

      expect(result).toBe('')
    })

    it('should return empty string when block has no content property', () => {
      const blockWithoutContent = { id: 'test-block-1' }
      mocks.messageBlocksSelectors.selectById.mockReturnValue(blockWithoutContent)

      const result = extractTableMarkdown('test-block-1', createTablePosition())

      expect(result).toBe('')
    })

    it('should return empty string when block content is not a string', () => {
      const blockWithInvalidContent = { id: 'test-block-1', content: 123 }
      mocks.messageBlocksSelectors.selectById.mockReturnValue(blockWithInvalidContent)

      const result = extractTableMarkdown('test-block-1', createTablePosition())

      expect(result).toBe('')
    })

    it('should handle boundary line numbers correctly', () => {
      const block = createMockBlock('Line 1\nLine 2\nLine 3')
      const position = createTablePosition(1, 3)
      mocks.messageBlocksSelectors.selectById.mockReturnValue(block)

      const result = extractTableMarkdown('test-block-1', position)

      expect(result).toBe('Line 1\nLine 2\nLine 3')
    })
  })

  describe('copy functionality', () => {
    beforeEach(() => {
      mocks.messageBlocksSelectors.selectById.mockReturnValue(createMockBlock())
    })

    it('should copy table content to clipboard on button click', async () => {
      render(<Table {...defaultProps} />)

      const copyButton = getCopyButton()
      await user.click(copyButton)

      await waitFor(() => {
        expect(getCheckIcon()).toBeInTheDocument()
        expect(queryCopyIcon()).not.toBeInTheDocument()
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

    it('should not copy when extractTableMarkdown returns empty string', async () => {
      mocks.messageBlocksSelectors.selectById.mockReturnValue(null)

      render(<Table {...defaultProps} />)

      const copyButton = getCopyButton()
      await user.click(copyButton)

      await waitFor(() => {
        expect(getCopyIcon()).toBeInTheDocument()
        expect(queryCheckIcon()).not.toBeInTheDocument()
      })
    })
  })

  describe('edge cases', () => {
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
