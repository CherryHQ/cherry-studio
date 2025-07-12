import type { ThinkingMessageBlock } from '@renderer/types/newMessage'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { render, screen } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ThinkingBlock from '../ThinkingBlock'

// Mock dependencies
const mockUseSettings = vi.fn()
const mockUseTranslation = vi.fn()

// Mock hooks
vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: () => mockUseSettings()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => mockUseTranslation()
}))

// Mock antd components
vi.mock('antd', () => ({
  Collapse: ({ activeKey, onChange, items, className, size, expandIconPosition }: any) => (
    <div
      data-testid="collapse-container"
      className={className}
      data-active-key={activeKey}
      data-size={size}
      data-expand-icon-position={expandIconPosition}>
      {items.map((item: any) => (
        <div key={item.key} data-testid={`collapse-item-${item.key}`}>
          <div data-testid={`collapse-header-${item.key}`} onClick={() => onChange()}>
            {item.label}
          </div>
          {activeKey === item.key && <div data-testid={`collapse-content-${item.key}`}>{item.children}</div>}
        </div>
      ))}
    </div>
  ),
  Tooltip: ({ title, children, mouseEnterDelay }: any) => (
    <div data-testid="tooltip" title={title} data-mouse-enter-delay={mouseEnterDelay}>
      {children}
    </div>
  ),
  message: {
    success: vi.fn(),
    error: vi.fn()
  }
}))

// Mock icons
vi.mock('@ant-design/icons', () => ({
  CheckOutlined: ({ style }: any) => (
    <span data-testid="check-icon" style={style}>
      ✓
    </span>
  )
}))

vi.mock('lucide-react', () => ({
  Lightbulb: ({ size }: any) => (
    <span data-testid="lightbulb-icon" data-size={size}>
      💡
    </span>
  ),
  ChevronRight: (props: any) => <svg data-testid="chevron-right-icon" {...props} />
}))

// Mock motion
vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: any) => <div data-testid="animate-presence">{children}</div>,
  motion: {
    div: (props: any) => <div {...props} />,
    span: ({ children, variants, animate, initial, style }: any) => (
      <span
        data-testid="motion-span"
        data-variants={JSON.stringify(variants)}
        data-animate={animate}
        data-initial={initial}
        style={style}>
        {children}
      </span>
    )
  }
}))

// Mock motion variants
vi.mock('@renderer/utils/motionVariants', () => ({
  lightbulbVariants: {
    active: { rotate: 10, scale: 1.1 },
    idle: { rotate: 0, scale: 1 }
  }
}))

// Mock Markdown component
vi.mock('@renderer/pages/home/Markdown/Markdown', () => ({
  __esModule: true,
  default: ({ block }: any) => (
    <div data-testid="mock-markdown" data-block-id={block.id}>
      Markdown: {block.content}
    </div>
  )
}))

// Mock ThinkingEffect component
vi.mock('@renderer/components/ThinkingEffect', () => ({
  __esModule: true,
  default: ({ isThinking, thinkingTimeText, content, expanded }: any) => (
    <div
      data-testid="mock-marquee-component"
      data-is-thinking={isThinking}
      data-expanded={expanded}
      data-content={content}>
      <div data-testid="thinking-time-text">{thinkingTimeText}</div>
    </div>
  )
}))

describe('ThinkingBlock', () => {
  beforeEach(async () => {
    vi.useFakeTimers()

    // Default mock implementations
    mockUseSettings.mockReturnValue({
      messageFont: 'sans-serif',
      fontSize: 14,
      thoughtAutoCollapse: false
    })

    mockUseTranslation.mockReturnValue({
      t: (key: string, params?: any) => {
        if (key === 'chat.thinking' && params?.seconds) {
          return `Thinking... ${params.seconds}s`
        }
        if (key === 'chat.deeply_thought' && params?.seconds) {
          return `Thought for ${params.seconds}s`
        }
        if (key === 'message.copied') return 'Copied!'
        if (key === 'message.copy.failed') return 'Copy failed'
        if (key === 'common.copy') return 'Copy'
        return key
      }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  // Test data factory functions
  const createThinkingBlock = (overrides: Partial<ThinkingMessageBlock> = {}): ThinkingMessageBlock => ({
    id: 'test-thinking-block-1',
    messageId: 'test-message-1',
    type: MessageBlockType.THINKING,
    status: MessageBlockStatus.SUCCESS,
    createdAt: new Date().toISOString(),
    content: 'I need to think about this carefully...',
    thinking_millsec: 5000,
    ...overrides
  })

  // Helper functions
  const renderThinkingBlock = (block: ThinkingMessageBlock) => {
    return render(<ThinkingBlock block={block} />)
  }

  const getThinkingContent = () => screen.queryByText(/markdown:/i)
  const getCopyButton = () => screen.queryByRole('button', { name: /copy/i })
  const getThinkingTimeText = () => screen.getByTestId('thinking-time-text')

  describe('basic rendering', () => {
    it('should render thinking content when provided', () => {
      const block = createThinkingBlock({ content: 'Deep thoughts about AI' })
      renderThinkingBlock(block)

      // User should see the thinking content
      expect(screen.getByText('Markdown: Deep thoughts about AI')).toBeInTheDocument()
      expect(screen.getByTestId('mock-marquee-component')).toBeInTheDocument()
    })

    it('should not render when content is empty', () => {
      const testCases = ['', undefined]

      testCases.forEach((content) => {
        const block = createThinkingBlock({ content: content as any })
        const { container, unmount } = renderThinkingBlock(block)
        expect(container.firstChild).toBeNull()
        unmount()
      })
    })

    it('should show copy button only when thinking is complete', () => {
      // When thinking (streaming)
      const thinkingBlock = createThinkingBlock({ status: MessageBlockStatus.STREAMING })
      const { rerender } = renderThinkingBlock(thinkingBlock)

      expect(getCopyButton()).not.toBeInTheDocument()

      // When thinking is complete
      const completedBlock = createThinkingBlock({ status: MessageBlockStatus.SUCCESS })
      rerender(<ThinkingBlock block={completedBlock} />)

      expect(getCopyButton()).toBeInTheDocument()
    })

    it('should match snapshot', () => {
      const block = createThinkingBlock()
      const { container } = renderThinkingBlock(block)
      expect(container.firstChild).toMatchSnapshot()
    })
  })

  describe('thinking time display', () => {
    it('should display appropriate time messages based on status', () => {
      // Completed thinking
      const completedBlock = createThinkingBlock({
        thinking_millsec: 3500,
        status: MessageBlockStatus.SUCCESS
      })
      const { unmount } = renderThinkingBlock(completedBlock)

      const timeText = getThinkingTimeText()
      expect(timeText).toHaveTextContent('3.5s')
      expect(timeText).toHaveTextContent('Thought for')
      unmount()

      // Active thinking
      const thinkingBlock = createThinkingBlock({
        thinking_millsec: 1000,
        status: MessageBlockStatus.STREAMING
      })
      renderThinkingBlock(thinkingBlock)

      const activeTimeText = getThinkingTimeText()
      expect(activeTimeText).toHaveTextContent('1.0s')
      expect(activeTimeText).toHaveTextContent('Thinking...')
    })

    it('should update thinking time in real-time when active', () => {
      const block = createThinkingBlock({
        thinking_millsec: 1000,
        status: MessageBlockStatus.STREAMING
      })
      renderThinkingBlock(block)

      // Initial state
      expect(getThinkingTimeText()).toHaveTextContent('1.0s')

      // After time passes
      act(() => {
        vi.advanceTimersByTime(500)
      })

      expect(getThinkingTimeText()).toHaveTextContent('1.5s')
    })

    it('should handle extreme thinking times correctly', () => {
      const testCases = [
        { thinking_millsec: 0, expectedTime: '0.0s' },
        { thinking_millsec: undefined, expectedTime: '0.0s' },
        { thinking_millsec: 86400000, expectedTime: '86400.0s' }, // 1 day
        { thinking_millsec: 259200000, expectedTime: '259200.0s' } // 3 days
      ]

      testCases.forEach(({ thinking_millsec, expectedTime }) => {
        const block = createThinkingBlock({
          thinking_millsec,
          status: MessageBlockStatus.SUCCESS
        })
        const { unmount } = renderThinkingBlock(block)
        expect(getThinkingTimeText()).toHaveTextContent(expectedTime)
        unmount()
      })
    })

    it('should stop timer when thinking status changes to completed', () => {
      const block = createThinkingBlock({
        thinking_millsec: 1000,
        status: MessageBlockStatus.STREAMING
      })
      const { rerender } = renderThinkingBlock(block)

      // Advance timer while thinking
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      expect(getThinkingTimeText()).toHaveTextContent('2.0s')

      // Complete thinking
      const completedBlock = createThinkingBlock({
        thinking_millsec: 1000, // Original time doesn't matter
        status: MessageBlockStatus.SUCCESS
      })
      rerender(<ThinkingBlock block={completedBlock} />)

      // Timer should stop - text should change from "Thinking..." to "Thought for"
      const timeText = getThinkingTimeText()
      expect(timeText).toHaveTextContent('Thought for')
      expect(timeText).toHaveTextContent('2.0s')

      // Further time advancement shouldn't change the display
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      expect(timeText).toHaveTextContent('2.0s')
    })
  })

  describe('collapse behavior', () => {
    it('should respect auto-collapse setting for initial state', () => {
      // Test expanded by default (auto-collapse disabled)
      mockUseSettings.mockReturnValue({
        messageFont: 'sans-serif',
        fontSize: 14,
        thoughtAutoCollapse: false
      })

      const block = createThinkingBlock()
      const { unmount } = renderThinkingBlock(block)

      // Content should be visible when expanded
      expect(getThinkingContent()).toBeInTheDocument()
      unmount()

      // Test collapsed by default (auto-collapse enabled)
      mockUseSettings.mockReturnValue({
        messageFont: 'sans-serif',
        fontSize: 14,
        thoughtAutoCollapse: true
      })

      renderThinkingBlock(block)

      // Content should not be visible when collapsed
      expect(getThinkingContent()).not.toBeInTheDocument()
    })

    it('should auto-collapse when thinking completes if setting enabled', () => {
      mockUseSettings.mockReturnValue({
        messageFont: 'sans-serif',
        fontSize: 14,
        thoughtAutoCollapse: true
      })

      const streamingBlock = createThinkingBlock({ status: MessageBlockStatus.STREAMING })
      const { rerender } = renderThinkingBlock(streamingBlock)

      // With thoughtAutoCollapse enabled, it should be collapsed even while thinking
      expect(getThinkingContent()).not.toBeInTheDocument()

      // Stop thinking
      const completedBlock = createThinkingBlock({ status: MessageBlockStatus.SUCCESS })
      rerender(<ThinkingBlock block={completedBlock} />)

      // Should remain collapsed after thinking completes
      expect(getThinkingContent()).not.toBeInTheDocument()
    })
  })

  describe('font and styling', () => {
    it('should apply font settings to thinking content', () => {
      const testCases = [
        {
          settings: { messageFont: 'serif', fontSize: 16 },
          expectedFont: 'var(--font-family-serif)',
          expectedSize: '16px'
        },
        {
          settings: { messageFont: 'sans-serif', fontSize: 14 },
          expectedFont: 'var(--font-family)',
          expectedSize: '14px'
        }
      ]

      testCases.forEach(({ settings, expectedFont, expectedSize }) => {
        mockUseSettings.mockReturnValue({
          ...settings,
          thoughtAutoCollapse: false
        })

        const block = createThinkingBlock()
        const { unmount } = renderThinkingBlock(block)

        // Find the styled content container
        const contentContainer = screen.getByTestId('collapse-content-thought')
        const styledDiv = contentContainer.querySelector('div')

        expect(styledDiv).toHaveStyle({
          fontFamily: expectedFont,
          fontSize: expectedSize
        })

        unmount()
      })
    })
  })

  describe('integration and edge cases', () => {
    it('should handle content updates correctly', () => {
      const block1 = createThinkingBlock({ content: 'Original thought' })
      const { rerender } = renderThinkingBlock(block1)

      expect(screen.getByText('Markdown: Original thought')).toBeInTheDocument()

      const block2 = createThinkingBlock({ content: 'Updated thought' })
      rerender(<ThinkingBlock block={block2} />)

      expect(screen.getByText('Markdown: Updated thought')).toBeInTheDocument()
      expect(screen.queryByText('Markdown: Original thought')).not.toBeInTheDocument()
    })

    it('should clean up timer on unmount', () => {
      const block = createThinkingBlock({ status: MessageBlockStatus.STREAMING })
      const { unmount } = renderThinkingBlock(block)

      const clearIntervalSpy = vi.spyOn(global, 'clearInterval')
      unmount()

      expect(clearIntervalSpy).toHaveBeenCalled()
    })

    it('should handle rapid status changes gracefully', () => {
      const block = createThinkingBlock({ status: MessageBlockStatus.STREAMING })
      const { rerender } = renderThinkingBlock(block)

      // Rapidly toggle between states
      for (let i = 0; i < 3; i++) {
        rerender(<ThinkingBlock block={createThinkingBlock({ status: MessageBlockStatus.STREAMING })} />)
        rerender(<ThinkingBlock block={createThinkingBlock({ status: MessageBlockStatus.SUCCESS })} />)
      }

      // Should still render correctly
      expect(getThinkingContent()).toBeInTheDocument()
      expect(getCopyButton()).toBeInTheDocument()
    })
  })
})
