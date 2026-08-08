import { act, fireEvent, render, screen, within } from '@testing-library/react'
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
}

vi.mock('../../MessageListProvider', () => ({
  useMessageRenderConfig: () => mockRenderConfig
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

    mockUseTranslation.mockReturnValue({
      t: (key: string) => {
        if (key === 'message.tools.placeholder.thinking') return 'Thinking'
        if (key === 'common.reasoning_content') return 'Deep reasoning'
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
    ...overrides
  })

  const renderThinkingBlock = (block: ThinkingBlockFixture, props: { showTitlePreview?: boolean } = {}) => {
    return render(
      <ThinkingBlock
        id={block.id}
        content={block.content}
        isStreaming={block.status === 'streaming'}
        showTitlePreview={props.showTitlePreview}
      />
    )
  }

  const getThinkingContent = () => screen.queryByText(/markdown:/i)
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
      expect(
        screen.getByText('Markdown: Deep thoughts about AI').closest('[data-ui~="part:message-reasoning"]')
      ).not.toBeNull()
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

    it('should not show a reasoning preview in the title by default', () => {
      const block = createThinkingBlock({ content: 'First thought\n\nsecond thought\tthird thought' })
      renderThinkingBlock(block)

      expect(screen.queryByText('First thought second thought third thought')).toBeNull()
      expect(getToggleButton()).toHaveAttribute('aria-expanded', 'false')
      expect(getContentContainer()).toHaveAttribute('hidden')
    })

    it('should show a single-line reasoning preview in the title when enabled', () => {
      const block = createThinkingBlock({ content: 'First thought\n\nsecond thought\tthird thought' })
      renderThinkingBlock(block, { showTitlePreview: true })

      expect(screen.getByText('First thought second thought third thought')).toBeInTheDocument()
      expect(getToggleButton()).toHaveAttribute('aria-expanded', 'false')
      expect(getContentContainer()).toHaveAttribute('hidden')
    })

    it('should show the latest completed segment after the preview has remained stable for one second', async () => {
      const block = createThinkingBlock({
        status: 'streaming',
        content: 'First line\nsecond thought in progress'
      })
      const { rerender } = renderThinkingBlock(block)

      expect(within(getToggleButton()).getByText('First line')).toBeInTheDocument()
      expect(within(getToggleButton()).queryByText('second thought in progress')).toBeNull()

      rerender(
        <ThinkingBlock
          id={block.id}
          content={'First line\nsecond thought complete. third thought in progress'}
          isStreaming
        />
      )

      await act(() => vi.advanceTimersByTime(500))
      rerender(
        <ThinkingBlock
          id={block.id}
          content={'First line\nsecond thought complete. third thought complete. fourth thought in progress'}
          isStreaming
        />
      )

      await act(() => vi.advanceTimersByTime(499))
      expect(within(getToggleButton()).getByText('First line')).toBeInTheDocument()
      expect(within(getToggleButton()).queryByText('second thought complete.')).toBeNull()
      expect(within(getToggleButton()).queryByText('third thought complete.')).toBeNull()

      await act(() => vi.advanceTimersByTime(1))
      expect(within(getToggleButton()).getByText('third thought complete.')).toBeInTheDocument()
      expect(within(getToggleButton()).queryByText('fourth thought in progress')).toBeNull()
    })

    it('should keep unfinished streaming text out of the title until a segment is completed', () => {
      const block = createThinkingBlock({ status: 'streaming', content: 'Still thinking without a boundary' })
      renderThinkingBlock(block)

      expect(within(getToggleButton()).queryByText('Still thinking without a boundary')).toBeNull()
      expect(screen.getByTestId('thinking-loading-indicator')).toBeInTheDocument()
    })

    it('should wait for a following character before treating trailing ASCII punctuation as complete', () => {
      const block = createThinkingBlock({ status: 'streaming', content: 'First line\nVersion 3.' })
      const { rerender } = renderThinkingBlock(block)

      expect(within(getToggleButton()).getByText('First line')).toBeInTheDocument()
      expect(within(getToggleButton()).queryByText('Version 3.')).toBeNull()

      rerender(<ThinkingBlock id={block.id} content={'First line\nVersion 3.1 is still streaming'} isStreaming />)

      expect(within(getToggleButton()).getByText('First line')).toBeInTheDocument()
      expect(within(getToggleButton()).queryByText('Version 3.')).toBeNull()
    })

    it('should keep consecutive CJK sentence endings with the completed segment', () => {
      const block = createThinkingBlock({ status: 'streaming', content: '真的吗？！还要继续思考' })
      renderThinkingBlock(block)

      expect(within(getToggleButton()).getByText('真的吗？！')).toBeInTheDocument()
    })

    it('should show the loading indicator only while thinking is streaming', () => {
      const block = createThinkingBlock({ status: 'streaming' })
      const { rerender } = renderThinkingBlock(block)

      expect(screen.getByTestId('thinking-loading-indicator')).toBeInTheDocument()

      rerender(<ThinkingBlock id={block.id} content={block.content} isStreaming={false} />)

      expect(screen.queryByTestId('thinking-loading-indicator')).toBeNull()
      expect(getThinkingTimeText()).toHaveTextContent('Deep reasoning')
    })
  })

  describe('thinking status display', () => {
    it('should display status messages without elapsed seconds', () => {
      // Completed thinking
      const completedBlock = createThinkingBlock({ status: 'success' })
      const { unmount } = renderThinkingBlock(completedBlock)

      const timeText = getThinkingTimeText()
      expect(timeText).toHaveTextContent('Deep reasoning')
      expect(timeText).not.toHaveTextContent('3.5s')
      unmount()

      // Active thinking
      const thinkingBlock = createThinkingBlock({ status: 'streaming' })
      renderThinkingBlock(thinkingBlock)

      const activeTimeText = getThinkingTimeText()
      expect(activeTimeText).toHaveTextContent('Thinking')
      expect(activeTimeText).not.toHaveTextContent('1.0s')
    })
  })

  describe('collapse behavior', () => {
    it('should render collapsed by default', () => {
      const block = createThinkingBlock()
      renderThinkingBlock(block)

      expect(getToggleButton()).toHaveAttribute('aria-expanded', 'false')
      expect(getContentContainer()).toHaveAttribute('hidden')
      expect(getThinkingContent()).toBeInTheDocument()
    })

    it('should toggle expanded state when clicked', () => {
      const block = createThinkingBlock()
      renderThinkingBlock(block)

      fireEvent.click(getToggleButton())

      expect(getToggleButton()).toHaveAttribute('aria-expanded', 'true')
      expect(getContentContainer()).not.toHaveAttribute('hidden')
    })
  })

  describe('integration and edge cases', () => {
    it('should handle content updates correctly', () => {
      const block1 = createThinkingBlock({ content: 'Original thought' })
      const { rerender } = renderThinkingBlock(block1)

      expect(screen.getByText('Markdown: Original thought')).toBeInTheDocument()

      const block2 = createThinkingBlock({ content: 'Updated thought' })
      rerender(<ThinkingBlock id={block2.id} content={block2.content} isStreaming={block2.status === 'streaming'} />)

      expect(screen.getByText('Markdown: Updated thought')).toBeInTheDocument()
      expect(screen.queryByText('Markdown: Original thought')).not.toBeInTheDocument()
    })
  })
})
