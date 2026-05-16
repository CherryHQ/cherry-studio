import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ThinkingBlock from '../ThinkingBlock'

// Mock dependencies
const mockUseTranslation = vi.fn()
const mockRenderConfig = vi.hoisted(() => ({
  messageFont: 'sans-serif',
  fontSize: 14,
  thoughtAutoCollapse: false
}))
type ThinkingBlockFixture = {
  id: string
  content: string
  status: 'success' | 'streaming'
  thinkingMs: number
}

vi.mock('../../MessageListProvider', () => ({
  useMessageRenderConfig: () => mockRenderConfig
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => mockUseTranslation()
}))

// Mock Markdown component
vi.mock('@renderer/components/chat/messages/markdown/Markdown', () => ({
  __esModule: true,
  default: ({ block }: any) => (
    <div data-testid="mock-markdown" data-block-id={block.id}>
      Markdown: {block.content}
    </div>
  )
}))

// Mock ThinkingEffect component
vi.mock('../ThinkingEffect', () => ({
  __esModule: true,
  default: ({ isThinking, thinkingTimeText, expanded }: any) => (
    <div data-testid="mock-marquee-component" data-is-thinking={isThinking} data-expanded={expanded}>
      <div data-testid="thinking-time-text">{thinkingTimeText}</div>
    </div>
  )
}))

describe('ThinkingBlock', () => {
  beforeEach(async () => {
    vi.useFakeTimers()

    mockRenderConfig.messageFont = 'sans-serif'
    mockRenderConfig.fontSize = 14
    mockRenderConfig.thoughtAutoCollapse = false

    mockUseTranslation.mockReturnValue({
      t: (key: string, params?: any) => {
        if (key === 'chat.thinking' && params?.seconds) {
          return `Thinking... ${params.seconds}s`
        }
        if (key === 'chat.deeply_thought' && params?.seconds) {
          return `Thought for ${params.seconds}s`
        }
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
  const createThinkingBlock = (overrides: Partial<ThinkingBlockFixture> = {}): ThinkingBlockFixture => ({
    id: 'test-thinking-block-1',
    status: 'success',
    content: 'I need to think about this carefully...',
    thinkingMs: 5000,
    ...overrides
  })

  const renderThinkingBlock = (block: ThinkingBlockFixture) => {
    return render(
      <ThinkingBlock
        id={block.id}
        content={block.content}
        isStreaming={block.status === 'streaming'}
        thinkingMs={block.thinkingMs}
      />
    )
  }

  const getThinkingContent = () => screen.queryByText(/markdown:/i)
  const getCopyButton = () => screen.queryByRole('button', { name: /copy/i })
  const getThinkingTimeText = () => screen.getByTestId('thinking-time-text')
  const getToggleButton = () => screen.getByRole('button')
  const getContentContainer = () => {
    const contentId = getToggleButton().getAttribute('aria-controls')
    if (!contentId) throw new Error('Missing thinking content id')
    return document.getElementById(contentId)
  }

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

    it('should not show copy button', () => {
      // When thinking (streaming)
      const thinkingBlock = createThinkingBlock({ status: 'streaming' })
      const { rerender } = renderThinkingBlock(thinkingBlock)

      expect(getCopyButton()).not.toBeInTheDocument()

      // When thinking is complete
      const completedBlock = createThinkingBlock({ status: 'success' })
      rerender(
        <ThinkingBlock
          id={completedBlock.id}
          content={completedBlock.content}
          isStreaming={completedBlock.status === 'streaming'}
          thinkingMs={completedBlock.thinkingMs}
        />
      )

      expect(getCopyButton()).not.toBeInTheDocument()
    })
  })

  describe('thinking time display', () => {
    it('should display appropriate time messages based on status', () => {
      // Completed thinking
      const completedBlock = createThinkingBlock({
        thinkingMs: 3500,
        status: 'success'
      })
      const { unmount } = renderThinkingBlock(completedBlock)

      const timeText = getThinkingTimeText()
      expect(timeText).toHaveTextContent('3.5s')
      expect(timeText).toHaveTextContent('Thought for')
      unmount()

      // Active thinking
      const thinkingBlock = createThinkingBlock({
        thinkingMs: 1000,
        status: 'streaming'
      })
      renderThinkingBlock(thinkingBlock)

      const activeTimeText = getThinkingTimeText()
      expect(activeTimeText).toHaveTextContent('Thinking...')
    })

    it('should handle extreme thinking times correctly', () => {
      const testCases = [
        { thinkingMs: 0, expectedTime: '0.1s' },
        { thinkingMs: 86400000, expectedTime: '86400.0s' },
        { thinkingMs: 259200000, expectedTime: '259200.0s' }
      ]

      testCases.forEach(({ thinkingMs, expectedTime }) => {
        const block = createThinkingBlock({
          thinkingMs,
          status: 'success'
        })
        const { unmount } = renderThinkingBlock(block)
        expect(getThinkingTimeText()).toHaveTextContent(expectedTime)
        unmount()
      })
    })

    it('should clamp invalid thinking times to a safe default', () => {
      const testCases = [undefined, Number.NaN, Number.POSITIVE_INFINITY]

      testCases.forEach((thinkingMs) => {
        const block = createThinkingBlock({
          thinkingMs: thinkingMs as any,
          status: 'success'
        })
        const { unmount } = renderThinkingBlock(block)
        expect(getThinkingTimeText()).toHaveTextContent('0.1s')
        unmount()
      })
    })
  })

  describe('collapse behavior', () => {
    it('should render collapsed by default', () => {
      const block = createThinkingBlock()
      const { unmount } = renderThinkingBlock(block)

      expect(getToggleButton()).toHaveAttribute('aria-expanded', 'false')
      expect(getContentContainer()).toHaveAttribute('hidden')
      expect(getThinkingContent()).toBeInTheDocument()
      unmount()

      mockRenderConfig.thoughtAutoCollapse = true

      renderThinkingBlock(block)

      expect(getToggleButton()).toHaveAttribute('aria-expanded', 'false')
      expect(getContentContainer()).toHaveAttribute('hidden')
    })

    it('should auto-collapse when thinking completes if setting enabled', () => {
      mockRenderConfig.thoughtAutoCollapse = true

      const streamingBlock = createThinkingBlock({ status: 'streaming' })
      const { rerender } = renderThinkingBlock(streamingBlock)

      expect(getToggleButton()).toHaveAttribute('aria-expanded', 'false')

      // Stop thinking
      const completedBlock = createThinkingBlock({ status: 'success' })
      rerender(
        <ThinkingBlock
          id={completedBlock.id}
          content={completedBlock.content}
          isStreaming={completedBlock.status === 'streaming'}
          thinkingMs={completedBlock.thinkingMs}
        />
      )

      // Should remain collapsed
      expect(getToggleButton()).toHaveAttribute('aria-expanded', 'false')
      expect(getContentContainer()).toHaveAttribute('hidden')
    })

    it('should toggle expanded state when clicked', () => {
      const block = createThinkingBlock()
      renderThinkingBlock(block)

      fireEvent.click(getToggleButton())

      expect(getToggleButton()).toHaveAttribute('aria-expanded', 'true')
      expect(getContentContainer()).not.toHaveAttribute('hidden')
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
        mockRenderConfig.messageFont = settings.messageFont
        mockRenderConfig.fontSize = settings.fontSize
        mockRenderConfig.thoughtAutoCollapse = false

        const block = createThinkingBlock()
        const { unmount } = renderThinkingBlock(block)

        const styledDiv = screen.getByTestId('mock-markdown').parentElement

        expect(styledDiv).toHaveClass('[&_.markdown>p:only-child]:mb-0!')
        expect(styledDiv).toHaveStyle({
          '--color-text': 'var(--color-foreground-muted)',
          '--color-text-light': 'var(--color-foreground-muted)',
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
      rerender(
        <ThinkingBlock
          id={block2.id}
          content={block2.content}
          isStreaming={block2.status === 'streaming'}
          thinkingMs={block2.thinkingMs}
        />
      )

      expect(screen.getByText('Markdown: Updated thought')).toBeInTheDocument()
      expect(screen.queryByText('Markdown: Original thought')).not.toBeInTheDocument()
    })

    it('should handle rapid status changes gracefully', () => {
      const block = createThinkingBlock({ status: 'streaming' })
      const { rerender } = renderThinkingBlock(block)

      // Rapidly toggle between states
      for (let i = 0; i < 3; i++) {
        const streamingBlock = createThinkingBlock({ status: 'streaming' })
        rerender(
          <ThinkingBlock
            id={streamingBlock.id}
            content={streamingBlock.content}
            isStreaming={true}
            thinkingMs={streamingBlock.thinkingMs}
          />
        )
        const successBlock = createThinkingBlock({ status: 'success' })
        rerender(
          <ThinkingBlock
            id={successBlock.id}
            content={successBlock.content}
            isStreaming={false}
            thinkingMs={successBlock.thinkingMs}
          />
        )
      }

      // Should still render correctly
      expect(getThinkingContent()).toBeInTheDocument()
      expect(getCopyButton()).not.toBeInTheDocument()
    })
  })
})
