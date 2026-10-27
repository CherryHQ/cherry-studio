import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Scrollbar } from '@cherrystudio/ui'
import {
  getCachedMessageUiState,
  invalidateCachedMessageUiStates,
  updateCachedMessageUiState
} from '@renderer/services/messageUiStateCache'

import { MessagePartsScopeProvider } from '../MessagePartsContext'
import ThinkingBlock from '../ThinkingBlock'

// Exercise the real nested scrollbars; the renderer-wide mock only renders a div.
vi.unmock('@cherrystudio/ui')
vi.unmock('@data/CacheService')

// Mock dependencies
const mockUseTranslation = vi.fn()
const mockRenderConfig = vi.hoisted(() => ({
  messageFont: 'sans-serif',
  fontSize: 14,
  thoughtAutoCollapse: true
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
    cleanup()
    invalidateCachedMessageUiStates(['thinking-owner'])
    vi.useFakeTimers()

    mockRenderConfig.messageFont = 'sans-serif'
    mockRenderConfig.fontSize = 14
    mockRenderConfig.thoughtAutoCollapse = true

    mockUseTranslation.mockReturnValue({
      t: (key: string) => {
        if (key === 'message.tools.placeholder.thinking') return 'Thinking'
        if (key === 'common.reasoning_content') return 'Deep reasoning'
        return key
      }
    })
  })

  afterEach(() => {
    cleanup()
    invalidateCachedMessageUiStates(['thinking-owner'])
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
      />,
      {
        wrapper: ({ children }) => (
          <MessagePartsScopeProvider parts={[]} messageId="thinking-owner">
            {children}
          </MessagePartsScopeProvider>
        )
      }
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

    it('should render expanded by default when auto-collapse is disabled', () => {
      mockRenderConfig.thoughtAutoCollapse = false
      const block = createThinkingBlock()
      renderThinkingBlock(block)

      expect(getToggleButton()).toHaveAttribute('aria-expanded', 'true')
      expect(getContentContainer()).not.toHaveAttribute('hidden')
    })

    it('should collapse all blocks when auto-collapse is enabled', () => {
      mockRenderConfig.thoughtAutoCollapse = false
      const block = createThinkingBlock()
      const { rerender } = renderThinkingBlock(block)

      expect(getToggleButton()).toHaveAttribute('aria-expanded', 'true')

      mockRenderConfig.thoughtAutoCollapse = true
      rerender(<ThinkingBlock id={block.id} content={`${block.content} updated`} isStreaming={false} />)

      expect(getToggleButton()).toHaveAttribute('aria-expanded', 'false')
      expect(getContentContainer()).toHaveAttribute('hidden')
    })

    it('should expand all blocks when auto-collapse is disabled after being enabled', () => {
      mockRenderConfig.thoughtAutoCollapse = true
      const block = createThinkingBlock()
      const { rerender } = renderThinkingBlock(block)

      expect(getToggleButton()).toHaveAttribute('aria-expanded', 'false')

      mockRenderConfig.thoughtAutoCollapse = false
      rerender(<ThinkingBlock id={block.id} content={`${block.content} updated`} isStreaming={false} />)

      expect(getToggleButton()).toHaveAttribute('aria-expanded', 'true')
      expect(getContentContainer()).not.toHaveAttribute('hidden')
    })
  })

  describe('layout and readability', () => {
    it('keeps its own scrollbar visible when the message scrollbar returns to idle', async () => {
      mockRenderConfig.thoughtAutoCollapse = false
      const block = createThinkingBlock()
      render(
        <Scrollbar data-testid="message-scrollbar">
          <ThinkingBlock id={block.id} content={block.content} isStreaming={false} />
        </Scrollbar>
      )

      const messageScrollbar = screen.getByTestId('message-scrollbar')
      const panel = getContentContainer()!
      // The inner scrollbar must retain its theme color even when its ancestor becomes transparent.
      expect(messageScrollbar).toHaveStyle({ scrollbarColor: 'transparent transparent' })
      expect(panel).toHaveStyle({ scrollbarColor: 'var(--scrollbar-thumb) transparent' })

      fireEvent.scroll(messageScrollbar)
      fireEvent.scroll(panel)
      expect(messageScrollbar).toHaveStyle({ scrollbarColor: 'var(--scrollbar-thumb) transparent' })

      await act(() => vi.advanceTimersByTime(2000))

      expect(messageScrollbar).toHaveStyle({ scrollbarColor: 'transparent transparent' })
      expect(panel).toHaveStyle({ scrollbarColor: 'var(--scrollbar-thumb) transparent' })
    })

    it('uses viewport-aware max height on the content panel', () => {
      mockRenderConfig.thoughtAutoCollapse = false
      const block = createThinkingBlock()
      renderThinkingBlock(block)

      // Bound long reasoning to the viewport so the message list remains reachable.
      expect(getContentContainer()).toHaveClass('max-h-[min(32rem,60dvh)]')
    })

    it('uses theme-aware muted foreground for panel and markdown content', () => {
      mockRenderConfig.thoughtAutoCollapse = false
      const block = createThinkingBlock({ content: 'Readable reasoning text' })
      renderThinkingBlock(block)

      const panel = getContentContainer()!
      expect(panel).toHaveClass('text-muted-foreground')

      const markdownWrapper = screen.getByText('Markdown: Readable reasoning text').parentElement
      expect(markdownWrapper).toHaveClass('text-muted-foreground')
      expect(markdownWrapper).toHaveStyle({ '--markdown-foreground': 'var(--muted-foreground)' })
    })

    it('keeps short thinking content compact without a minimum panel height', () => {
      mockRenderConfig.thoughtAutoCollapse = false
      const block = createThinkingBlock({ content: 'Short thought.' })
      renderThinkingBlock(block)

      expect(getContentContainer()?.className).not.toMatch(/min-h-/)
    })
  })

  it('follows streamed thinking only while the reader remains at the bottom', () => {
    mockRenderConfig.thoughtAutoCollapse = false
    let resize: (() => void) | undefined
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resize = () => callback([], this as unknown as ResizeObserver)
        }
        observe() {}
        disconnect() {}
      }
    )
    try {
      renderThinkingBlock(createThinkingBlock({ status: 'streaming' }))
      const panel = getContentContainer()!
      let height = 200
      Object.defineProperties(panel, {
        clientHeight: { configurable: true, get: () => 100 },
        scrollHeight: { configurable: true, get: () => height }
      })
      act(() => resize?.())
      expect(panel.scrollTop).toBe(100)
      panel.scrollTop = 25
      fireEvent.scroll(panel)
      height = 400
      act(() => resize?.())
      expect(panel.scrollTop).toBe(25)
      panel.scrollTop = 300
      fireEvent.scroll(panel)
      height = 500
      act(() => resize?.())
      expect(panel.scrollTop).toBe(400)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  describe('reading position recovery', () => {
    let resizeCallbacks: Array<() => void>
    let panelHeight: number
    let viewportHeight: number

    beforeEach(() => {
      resizeCallbacks = []
      panelHeight = 200
      viewportHeight = 100
      vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => viewportHeight)
      vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => panelHeight)
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(callback: ResizeObserverCallback) {
            resizeCallbacks.push(() => callback([], this as unknown as ResizeObserver))
          }
          observe() {}
          disconnect() {}
        }
      )
    })

    afterEach(() => vi.unstubAllGlobals())
    const resize = () => act(() => resizeCallbacks.forEach((callback) => callback()))

    it.each([
      ['absent', undefined, 0],
      ['following', null, 300],
      ['reading', 75, 75],
      ['negative reading', -25, 0]
    ] as const)('opens completed reasoning at its %s position', (_mode, saved, expected) => {
      mockRenderConfig.thoughtAutoCollapse = false
      panelHeight = 400
      const id = 'completed-initial-position'
      if (saved !== undefined) {
        updateCachedMessageUiState('thinking-owner', { thinkingScroll: { [id]: saved } })
      }
      renderThinkingBlock(createThinkingBlock({ id, status: 'success' }))
      expect(getContentContainer()!.scrollTop).toBe(expected)
      resize()
      expect(getContentContainer()!.scrollTop).toBe(expected)
      if (saved === undefined) {
        expect(getCachedMessageUiState('thinking-owner').thinkingScroll?.[id]).toBeUndefined()
      }
    })

    it('restores reading position and expansion before observer and delayed scroll events', () => {
      const block = createThinkingBlock({ id: 'scroll-reading', status: 'streaming' })
      const first = renderThinkingBlock(block)
      fireEvent.click(getToggleButton())
      const panel = getContentContainer()!
      panel.scrollTop = 25
      fireEvent.scroll(panel)
      first.unmount()
      resizeCallbacks = []
      renderThinkingBlock(block)
      const restored = getContentContainer()!
      expect(getToggleButton()).toHaveAttribute('aria-expanded', 'true')
      expect(restored.scrollTop).toBe(25)
      fireEvent.scroll(restored)
      resize()
      expect(restored.scrollTop).toBe(25)
      panelHeight = 400
      resize()
      expect(restored.scrollTop).toBe(25)
    })

    it('restores following mode to the new real bottom after content grows while away', () => {
      mockRenderConfig.thoughtAutoCollapse = false
      const block = createThinkingBlock({ id: 'scroll-following', status: 'streaming' })
      const first = renderThinkingBlock(block)
      resize()
      expect(getContentContainer()!.scrollTop).toBe(100)
      first.unmount()
      resizeCallbacks = []
      panelHeight = 400
      renderThinkingBlock({ ...block, content: 'More thoughts arrived' })
      expect(getContentContainer()!.scrollTop).toBe(300)
      fireEvent.scroll(getContentContainer()!)
      panelHeight = 500
      resize()
      expect(getContentContainer()!.scrollTop).toBe(400)
    })

    it('preserves a pending reading target while hidden or unmeasurable', () => {
      const id = 'scroll-hidden'
      updateCachedMessageUiState('thinking-owner', {
        thinkingScroll: { [id]: 25 },
        disclosures: { [`thinking:${id}`]: false }
      })
      const block = createThinkingBlock({ id, status: 'streaming' })
      const first = renderThinkingBlock(block)
      fireEvent.scroll(getContentContainer()!)

      viewportHeight = 0
      fireEvent.click(getToggleButton())
      fireEvent.scroll(getContentContainer()!)
      resize()

      viewportHeight = 100
      resize()
      expect(getContentContainer()!.scrollTop).toBe(25)
      viewportHeight = 0
      first.unmount()
      viewportHeight = 100
      renderThinkingBlock(block)
      expect(getContentContainer()!.scrollTop).toBe(25)
    })

    it('saves user scrolling after the stream ends and clamps restoration to current geometry', () => {
      mockRenderConfig.thoughtAutoCollapse = false
      const block = createThinkingBlock({ id: 'scroll-completed', status: 'streaming' })
      const first = renderThinkingBlock(block)
      resize()
      first.rerender(<ThinkingBlock id={block.id} content={block.content} isStreaming={false} />)
      getContentContainer()!.scrollTop = 25
      fireEvent.scroll(getContentContainer()!)
      first.unmount()
      const second = renderThinkingBlock({ ...block, status: 'success' })
      expect(getContentContainer()!.scrollTop).toBe(25)
      second.unmount()
      panelHeight = 110
      renderThinkingBlock({ ...block, status: 'success' })
      expect(getContentContainer()!.scrollTop).toBe(10)
    })

    it('retry resets mounted expansion and following and rejects a late observer', () => {
      const id = 'scroll-invalidated'
      const view = renderThinkingBlock(createThinkingBlock({ id, status: 'streaming' }))
      fireEvent.click(getToggleButton())
      getContentContainer()!.scrollTop = 25
      fireEvent.scroll(getContentContainer()!)
      const oldCallbacks = [...resizeCallbacks]
      act(() =>
        updateCachedMessageUiState('thinking-owner', (current) => ({
          ...current,
          markdownSources: undefined,
          thinkingScroll: undefined,
          disclosures: undefined
        }))
      )
      expect(getToggleButton()).toHaveAttribute('aria-expanded', 'false')
      act(() => oldCallbacks.forEach((callback) => callback()))
      fireEvent.click(getToggleButton())
      panelHeight = 400
      resize()
      expect(getContentContainer()!.scrollTop).toBe(300)
      view.unmount()
      renderThinkingBlock(createThinkingBlock({ id, status: 'streaming' }))
      expect(getContentContainer()!.scrollTop).toBe(300)
    })

    it('keeps zero reading positions and clamped reading mode across growth', () => {
      mockRenderConfig.thoughtAutoCollapse = false
      const id = 'zero-reading'
      updateCachedMessageUiState('thinking-owner', { thinkingScroll: { [id]: 0 } })
      const first = renderThinkingBlock(createThinkingBlock({ id, status: 'streaming' }))
      expect(getContentContainer()!.scrollTop).toBe(0)
      panelHeight = 400
      resize()
      expect(getContentContainer()!.scrollTop).toBe(0)
      first.unmount()
      updateCachedMessageUiState('thinking-owner', { thinkingScroll: { [id]: 500 } })
      renderThinkingBlock(createThinkingBlock({ id, status: 'streaming' }))
      expect(getContentContainer()!.scrollTop).toBe(300)
      fireEvent.scroll(getContentContainer()!)
      panelHeight = 500
      resize()
      expect(getContentContainer()!.scrollTop).toBe(300)
    })

    it('retry discards a reading target that is still pending in a collapsed panel', () => {
      const id = 'pending-retry'
      updateCachedMessageUiState('thinking-owner', { thinkingScroll: { [id]: 25 } })
      renderThinkingBlock(createThinkingBlock({ id, status: 'streaming' }))
      act(() =>
        updateCachedMessageUiState('thinking-owner', (current) => ({
          ...current,
          markdownSources: undefined,
          thinkingScroll: undefined,
          disclosures: undefined
        }))
      )
      fireEvent.click(getToggleButton())
      expect(getContentContainer()!.scrollTop).toBe(100)
    })

    it('retry leaves another message reading at its own position', () => {
      mockRenderConfig.thoughtAutoCollapse = false
      const pair = () => (
        <>
          {['thinking-owner', 'other-thinking'].map((owner) => (
            <div key={owner} data-testid={owner}>
              <MessagePartsScopeProvider messageId={owner} parts={[]}>
                <ThinkingBlock id="shared-part" content="Thought" isStreaming />
              </MessagePartsScopeProvider>
            </div>
          ))}
        </>
      )
      const view = render(pair())
      const panel = (owner: string) =>
        screen.getByTestId(owner).querySelector<HTMLElement>('[id][class*="overflow-auto"]')!
      panel('thinking-owner').scrollTop = 25
      fireEvent.scroll(panel('thinking-owner'))
      panel('other-thinking').scrollTop = 40
      fireEvent.scroll(panel('other-thinking'))
      act(() =>
        updateCachedMessageUiState('thinking-owner', (current) => ({
          ...current,
          markdownSources: undefined,
          thinkingScroll: undefined,
          disclosures: undefined
        }))
      )
      panelHeight = 400
      resize()
      expect(panel('thinking-owner').scrollTop).toBe(300)
      expect(panel('other-thinking').scrollTop).toBe(40)
      view.unmount()
      const second = render(pair())
      expect(panel('other-thinking').scrollTop).toBe(40)
      second.unmount()
      invalidateCachedMessageUiStates(['other-thinking'])
    })

    it('preserves explicit disclosure choices when the default preference changes', () => {
      const id = 'scroll-preference'
      updateCachedMessageUiState('thinking-owner', {
        thinkingScroll: { [id]: 25 },
        disclosures: { [`thinking:${id}`]: true }
      })
      const view = renderThinkingBlock(createThinkingBlock({ id }))
      expect(getToggleButton()).toHaveAttribute('aria-expanded', 'true')
      mockRenderConfig.thoughtAutoCollapse = false
      view.rerender(<ThinkingBlock id={id} content="Changed content" isStreaming={false} />)
      mockRenderConfig.thoughtAutoCollapse = true
      view.rerender(<ThinkingBlock id={id} content="Changed content again" isStreaming={false} />)
      expect(getToggleButton()).toHaveAttribute('aria-expanded', 'true')
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
