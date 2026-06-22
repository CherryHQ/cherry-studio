import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ThinkingBlock from '../ThinkingBlock'

// Mock dependencies
const mockUseTranslation = vi.fn()
const mockMessageActions = vi.hoisted<{
  copyText?: ReturnType<typeof vi.fn>
  notifyError?: ReturnType<typeof vi.fn>
}>(() => ({
  copyText: vi.fn().mockResolvedValue(undefined),
  notifyError: vi.fn()
}))
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
  thoughtsTokens?: number
  startedAt?: number
}

vi.mock('../../MessageListProvider', () => ({
  useMessageRenderConfig: () => mockRenderConfig,
  useMessageListActions: () => mockMessageActions
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => mockUseTranslation()
}))

// Mock Markdown component
vi.mock('@renderer/components/chat/messages/markdown/ChatMarkdown', () => ({
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
  default: ({ isThinking, thinkingTimeText, expanded, trailing }: any) => (
    <div data-testid="mock-marquee-component" data-is-thinking={isThinking} data-expanded={expanded}>
      <div data-testid="thinking-time-text">{thinkingTimeText}</div>
      {trailing}
    </div>
  )
}))

describe('ThinkingBlock', () => {
  beforeEach(async () => {
    vi.useFakeTimers()

    mockRenderConfig.messageFont = 'sans-serif'
    mockRenderConfig.fontSize = 14
    mockRenderConfig.thoughtAutoCollapse = false

    mockMessageActions.copyText = vi.fn().mockResolvedValue(undefined)
    mockMessageActions.notifyError = vi.fn()

    // Stub clipboard + toast utilities used by the platform actions
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) }
    })
    ;(window as any).toast = {
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn()
    }

    mockUseTranslation.mockReturnValue({
      t: (key: string, params?: any) => {
        if (key === 'chat.thinking' && params?.seconds) {
          return `Thinking... ${params.seconds}s`
        }
        if (key === 'chat.deeply_thought' && params?.seconds) {
          return `Thought for ${params.seconds}s`
        }
        if (key === 'chat.thinking_tokens' && params?.tokens) {
          return `~${params.tokens} tokens`
        }
        if (key === 'common.reasoning_content') return 'Deep reasoning'
        if (key === 'common.copy') return 'Copy'
        if (key === 'message.copied') return 'Copied'
        if (key === 'common.copy_failed') return 'Copy failed'
        return key
      }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    vi.clearAllTimers()
    vi.useRealTimers()
    delete (window as any).toast
    delete (navigator as any).clipboard
  })

  // Test data factory functions
  const createThinkingBlock = (overrides: Partial<ThinkingBlockFixture> = {}): ThinkingBlockFixture => ({
    id: 'test-thinking-block-1',
    status: 'success',
    content: 'I need to think about this carefully...',
    thinkingMs: 5000,
    startedAt: undefined,
    ...overrides
  })

  const renderThinkingBlock = (block: ThinkingBlockFixture) => {
    return render(
      <ThinkingBlock
        id={block.id}
        content={block.content}
        isStreaming={block.status === 'streaming'}
        thinkingMs={block.thinkingMs}
        thoughtsTokens={block.thoughtsTokens}
        startedAt={block.startedAt}
      />
    )
  }

  const getThinkingContent = () => screen.queryByText(/markdown:/i)
  const getCopyButton = () => document.querySelector<HTMLButtonElement>('button[aria-label="Copy"]')
  const getThinkingTimeText = () => screen.getByTestId('thinking-time-text')
  const getToggleButton = () => document.querySelector<HTMLElement>('[aria-controls][aria-expanded][role="button"]')!
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

    it('should show copy button in both streaming and success states', () => {
      // When thinking (streaming)
      const thinkingBlock = createThinkingBlock({ status: 'streaming' })
      const { rerender } = renderThinkingBlock(thinkingBlock)

      expect(getCopyButton()).toBeInTheDocument()

      // When thinking is complete
      const completedBlock = createThinkingBlock({ status: 'success' })
      rerender(
        <ThinkingBlock
          id={completedBlock.id}
          content={completedBlock.content}
          isStreaming={completedBlock.status === 'streaming'}
          thinkingMs={completedBlock.thinkingMs}
          thoughtsTokens={completedBlock.thoughtsTokens}
        />
      )

      expect(getCopyButton()).toBeInTheDocument()
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

    it('should display live estimated thinking tokens when available', () => {
      const thinkingBlock = createThinkingBlock({
        status: 'streaming',
        thoughtsTokens: 1234
      })
      const { rerender } = renderThinkingBlock(thinkingBlock)

      expect(getThinkingTimeText()).toHaveTextContent('Thinking...')
      expect(getThinkingTimeText()).toHaveTextContent('~1,234 tokens')

      rerender(
        <ThinkingBlock
          id={thinkingBlock.id}
          content={thinkingBlock.content}
          isStreaming
          thinkingMs={thinkingBlock.thinkingMs}
          thoughtsTokens={2048}
        />
      )

      expect(getThinkingTimeText()).toHaveTextContent('~2,048 tokens')
    })

    it('should handle extreme thinking times correctly', () => {
      const testCases = [
        { thinkingMs: 0, expectedTime: 'Deep reasoning' },
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
        expect(getThinkingTimeText()).toHaveTextContent('Deep reasoning')
        unmount()
      })
    })

    it('should calculate active thinking time dynamically using startedAt if provided', () => {
      const baseTime = 1780913860106
      const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(baseTime)
      const startedAt = baseTime - 4500 // 4.5 seconds ago

      // 1. Initial mount with isStreaming=true
      const block = createThinkingBlock({
        thinkingMs: 0,
        status: 'streaming',
        startedAt
      })
      const { unmount } = renderThinkingBlock(block)

      // Time should be calculated as Date.now() - startedAt = 4500ms -> 4.5s
      expect(getThinkingTimeText()).toHaveTextContent('Thinking... 4.5s')

      // 2. Advance clock by 1.2 seconds, verify it updates correctly
      dateSpy.mockReturnValue(baseTime + 1200)
      act(() => {
        vi.advanceTimersByTime(1200)
      })
      expect(getThinkingTimeText()).toHaveTextContent('Thinking... 5.7s')

      // 3. Remount (simulate changing session / component remount)
      unmount()
      const { unmount: unmount2 } = renderThinkingBlock(block)
      expect(getThinkingTimeText()).toHaveTextContent('Thinking... 5.7s')
      unmount2()
    })

    it('should keep a static time when stream is finished, even if startedAt is provided', () => {
      const baseTime = 1780913860106
      const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(baseTime)
      const startedAt = baseTime - 5000

      // 1. Mount with status: 'success' and a fixed thinkingMs: 5000 (5.0s)
      const block = createThinkingBlock({
        thinkingMs: 5000,
        status: 'success',
        startedAt
      })
      const { unmount } = renderThinkingBlock(block)

      expect(getThinkingTimeText()).toHaveTextContent('Thought for 5.0s')

      // 2. Advance clock by 10 seconds, verify it stays at 5.0s (does not tick)
      dateSpy.mockReturnValue(baseTime + 10000)
      act(() => {
        vi.advanceTimersByTime(10000)
      })
      expect(getThinkingTimeText()).toHaveTextContent('Thought for 5.0s')

      // 3. Remount (simulate switching session back), verify it still renders 5.0s
      unmount()
      const { unmount: unmount2 } = renderThinkingBlock(block)
      expect(getThinkingTimeText()).toHaveTextContent('Thought for 5.0s')
      unmount2()
    })
  })

  describe('collapse behavior', () => {
    it('should render collapsed by default', () => {
      const block = createThinkingBlock()
      const { unmount } = renderThinkingBlock(block)

      expect(getToggleButton()).toHaveAttribute('aria-expanded', 'false')
      expect(getContentContainer()).toHaveAttribute('hidden')
      expect(getContentContainer()).toHaveClass('rounded-xl', 'bg-muted', 'px-4', 'py-3')
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
        expect(styledDiv).toHaveStyle('--color-text: var(--color-foreground-muted)')
        expect(styledDiv).toHaveStyle('--color-text-light: var(--color-foreground-muted)')
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
      expect(getCopyButton()).toBeInTheDocument()
    })
  })

  describe('copy button', () => {
    it('exposes an accessible label that mirrors the i18n tooltip copy', () => {
      renderThinkingBlock(createThinkingBlock())

      const button = getCopyButton()
      expect(button).not.toBeNull()
      expect(button).toHaveAttribute('aria-label', 'Copy')
    })

    it('is hidden by default and only revealed on hover/focus', () => {
      renderThinkingBlock(createThinkingBlock())

      const button = getCopyButton()
      expect(button).toHaveClass('opacity-0')
      expect(button).toHaveClass('group-hover/thought:opacity-100')
      expect(button).toHaveClass('focus-visible:opacity-100')
    })

    it('forwards the thinking markdown to actions.copyText on click', async () => {
      const block = createThinkingBlock({ content: 'I am thinking very hard...' })
      renderThinkingBlock(block)

      await act(async () => {
        fireEvent.click(getCopyButton()!)
        await vi.runAllTimersAsync()
        await Promise.resolve()
      })

      expect(mockMessageActions.copyText).toHaveBeenCalledTimes(1)
      expect(mockMessageActions.copyText).toHaveBeenCalledWith('I am thinking very hard...', {
        successMessage: 'Copied'
      })
    })

    it('does not invoke actions.copyText when there is no content', () => {
      const block = createThinkingBlock({ content: '' })
      const { container } = renderThinkingBlock(block)

      // ThinkingBlock returns null when content is empty, so no button exists
      expect(container.firstChild).toBeNull()
      expect(mockMessageActions.copyText).not.toHaveBeenCalled()
    })

    it('does not render copy button when copy action is unavailable', () => {
      mockMessageActions.copyText = undefined

      renderThinkingBlock(createThinkingBlock())

      expect(getCopyButton()).not.toBeInTheDocument()
    })

    it('keeps the copy button click from toggling the expand/collapse button', async () => {
      renderThinkingBlock(createThinkingBlock())

      const toggleButton = getToggleButton()
      expect(toggleButton).toHaveAttribute('aria-expanded', 'false')

      await act(async () => {
        fireEvent.click(getCopyButton()!)
        await vi.runAllTimersAsync()
        await Promise.resolve()
      })

      // The outer toggle button should still report the original state
      expect(getToggleButton()).toHaveAttribute('aria-expanded', 'false')
    })

    it('keeps copy button keyboard activation from toggling the expand/collapse button', () => {
      renderThinkingBlock(createThinkingBlock())

      expect(getToggleButton()).toHaveAttribute('aria-expanded', 'false')

      fireEvent.keyDown(getCopyButton()!, { key: 'Enter' })
      expect(getToggleButton()).toHaveAttribute('aria-expanded', 'false')

      fireEvent.keyDown(getCopyButton()!, { key: ' ' })
      expect(getToggleButton()).toHaveAttribute('aria-expanded', 'false')
    })

    it('surfaces a failure notification when copyText rejects', async () => {
      mockMessageActions.copyText?.mockRejectedValueOnce(new Error('clipboard unavailable'))

      renderThinkingBlock(createThinkingBlock({ content: 'I am thinking...' }))

      await act(async () => {
        fireEvent.click(getCopyButton()!)
        await vi.runAllTimersAsync()
        await Promise.resolve()
      })

      expect(mockMessageActions.copyText).toHaveBeenCalledTimes(1)
      expect(mockMessageActions.notifyError).toHaveBeenCalledWith('Copy failed')
      // After failure the success state must NOT flip on
      expect(getCopyButton()?.querySelector('svg.lucide-check')).toBeNull()
    })
  })
})
