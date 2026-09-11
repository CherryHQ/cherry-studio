// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const originalScrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'scrollIntoView')
let scrollTargets: Element[] = []

const mocks = vi.hoisted(() => ({
  topicPages: [] as any[],
  sessionPages: [] as any[],
  topicHasNext: false,
  sessionHasNext: false,
  topicIsRefreshing: false,
  sessionIsRefreshing: false,
  topicError: undefined as Error | undefined,
  sessionError: undefined as Error | undefined,
  topicLoadNext: vi.fn(),
  sessionLoadNext: vi.fn(),
  useInfiniteQuery: vi.fn(),
  onClose: vi.fn(),
  onOpenMessage: vi.fn(),
  virtualRangeEnd: Number.MAX_SAFE_INTEGER,
  virtualScrollToIndex: vi.fn()
}))
const flatItemsCache = vi.hoisted(() => new WeakMap<any[], Map<string, any[]>>())

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, type = 'button', ...props }: any) => (
    <button type={type} {...props}>
      {children}
    </button>
  )
}))

vi.mock('@data/hooks/useDataApi', () => ({
  useInfiniteQuery: (...args: unknown[]) => mocks.useInfiniteQuery(...args),
  useInfiniteFlatItems: (pages: any[] = [], options?: { reversePages?: boolean; reverseItems?: boolean }) => {
    const key = `${Boolean(options?.reversePages)}:${Boolean(options?.reverseItems)}`
    const cached = flatItemsCache.get(pages)?.get(key)
    if (cached) return cached

    const orderedPages = options?.reversePages ? [...pages].reverse() : pages
    const items = orderedPages.flatMap((page) => (options?.reverseItems ? [...page.items].reverse() : page.items))
    let optionCache = flatItemsCache.get(pages)
    if (!optionCache) {
      optionCache = new Map()
      flatItemsCache.set(pages, optionCache)
    }
    optionCache.set(key, items)
    return items
  }
}))

function mockPreviewInfiniteQuery(path: string) {
  if (path === '/topics/:topicId/messages') {
    return {
      pages: mocks.topicPages,
      isLoading: false,
      isRefreshing: mocks.topicIsRefreshing,
      error: mocks.topicError,
      hasNext: mocks.topicHasNext,
      loadNext: mocks.topicLoadNext
    }
  }

  return {
    pages: mocks.sessionPages,
    isLoading: false,
    isRefreshing: mocks.sessionIsRefreshing,
    error: mocks.sessionError,
    hasNext: mocks.sessionHasNext,
    loadNext: mocks.sessionLoadNext
  }
}

vi.mock('@renderer/components/chat/messages/MessageContentProvider', () => ({
  MessageContentProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock('@renderer/components/chat/messages/frame/MessageContent', () => ({
  default: ({ message }: any) => (
    <div>
      <span>message-content:{message.id}</span>
      <span> needle</span>
    </div>
  )
}))

vi.mock('@renderer/components/chat/messages/utils/messageListItem', () => ({
  toMessageListItem: (message: any) => message
}))

vi.mock('@renderer/components/VirtualList', async () => {
  const { useImperativeHandle } = await import('react')

  function MockDynamicVirtualList({
    ref,
    list,
    children,
    rangeExtractor,
    getItemKey,
    scrollElementRef,
    header,
    className,
    onScroll
  }: any) {
    useImperativeHandle(ref, () => ({ scrollToIndex: mocks.virtualScrollToIndex }))

    const endIndex = Math.min(mocks.virtualRangeEnd, list.length - 1)
    const range = { startIndex: 0, endIndex, overscan: 0, count: list.length }
    const indexes = rangeExtractor ? rangeExtractor(range) : Array.from({ length: endIndex + 1 }, (_, index) => index)

    return (
      <div ref={scrollElementRef} className={className} onScroll={onScroll}>
        {header}
        {indexes.map((index: number) => (
          <div key={getItemKey?.(index) ?? index}>{children(list[index], index)}</div>
        ))}
      </div>
    )
  }

  return { DynamicVirtualList: MockDynamicVirtualList }
})

vi.mock('@renderer/utils/style', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'common.close': 'Close',
        'common.loading': 'Loading...',
        'common.no_results': 'No results',
        'common.open': 'Open',
        'common.unnamed': 'Unnamed',
        'globalSearch.error': 'Search failed',
        'globalSearch.messageSearch.roles.assistant': 'Assistant',
        'globalSearch.messageSearch.roles.system': 'System',
        'globalSearch.messageSearch.roles.tool': 'Tool',
        'globalSearch.messageSearch.roles.user': 'User',
        'globalSearch.messageSearch.sources.session': 'Task messages',
        'globalSearch.messageSearch.sources.topic': 'Conversation messages'
      })[key] ?? key
  })
}))

import {
  GlobalSearchMessagePreviewPanel,
  type GlobalSearchMessagePreviewTarget
} from '../GlobalSearchMessagePreviewPanel'

const TOPIC_TARGET = {
  sourceType: 'topic',
  topicId: 'topic-1',
  title: 'Topic A',
  messageId: 'topic-message-2'
} satisfies GlobalSearchMessagePreviewTarget

const SESSION_TARGET = {
  sourceType: 'session',
  sessionId: 'session-1',
  title: 'Session A',
  messageId: 'session-message-1'
} satisfies GlobalSearchMessagePreviewTarget

function createTopicMessage(overrides: Record<string, unknown> = {}) {
  return {
    message: {
      id: 'topic-message-1',
      topicId: 'topic-1',
      parentId: null,
      role: 'user',
      data: { parts: [{ type: 'text', text: 'hello' }] },
      status: 'success',
      siblingsGroupId: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides
    }
  }
}

function createSessionMessage() {
  return {
    id: 'session-message-1',
    sessionId: 'session-1',
    role: 'assistant',
    data: { parts: [{ type: 'text', text: 'session reply' }] },
    status: 'success',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    modelId: null,
    messageSnapshot: null,
    traceId: null,
    stats: null,
    runtimeResumeToken: null,
    searchableText: 'session reply'
  }
}

function createPreviewProps(target: GlobalSearchMessagePreviewTarget = TOPIC_TARGET) {
  return {
    searchQuery: 'needle',
    target,
    onClose: mocks.onClose,
    onOpenMessage: mocks.onOpenMessage
  }
}

function renderPreview(target: GlobalSearchMessagePreviewTarget = TOPIC_TARGET) {
  return render(<GlobalSearchMessagePreviewPanel {...createPreviewProps(target)} />)
}

// jsdom does not lay out, so scroll geometry has to be stubbed for the scroll-to-load-older handler.
function setScrollGeometry(scroller: HTMLElement, geometry: { scrollTop: number; scrollHeight: number }) {
  Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: geometry.scrollHeight })
  scroller.scrollTop = geometry.scrollTop
}

describe('GlobalSearchMessagePreviewPanel', () => {
  beforeEach(() => {
    scrollTargets = []
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: function scrollIntoView(this: Element) {
        scrollTargets.push(this)
      }
    })
    mocks.topicPages = [
      {
        items: [
          createTopicMessage(),
          createTopicMessage({
            id: 'topic-message-2',
            parentId: 'topic-message-1',
            role: 'assistant',
            data: { parts: [{ type: 'text', text: 'reply' }] },
            createdAt: '2026-01-01T00:00:01.000Z',
            updatedAt: '2026-01-01T00:00:01.000Z'
          })
        ]
      }
    ]
    mocks.sessionPages = []
    mocks.topicHasNext = false
    mocks.sessionHasNext = false
    mocks.topicIsRefreshing = false
    mocks.sessionIsRefreshing = false
    mocks.topicError = undefined
    mocks.sessionError = undefined
    mocks.virtualRangeEnd = Number.MAX_SAFE_INTEGER
    mocks.useInfiniteQuery.mockImplementation(mockPreviewInfiniteQuery)
  })

  afterEach(() => {
    if (originalScrollIntoViewDescriptor) {
      Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', originalScrollIntoViewDescriptor)
    } else {
      delete (window.HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView
    }
    vi.clearAllMocks()
  })

  it('renders topic preview messages and opens the clicked message', async () => {
    const user = userEvent.setup()

    renderPreview()

    expect(screen.getByText('Topic A')).toBeInTheDocument()
    expect(screen.getByText('Conversation messages')).toBeInTheDocument()
    expect(screen.getByText('message-content:topic-message-1')).toBeInTheDocument()
    expect(screen.getByText('message-content:topic-message-2')).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByText('needle', { selector: 'mark' })).toHaveLength(2))
    await waitFor(() =>
      expect(
        scrollTargets.some(
          (element) =>
            element.matches('mark[data-global-search-preview-highlight="true"]') &&
            element.closest('#global-search-preview-message-topic-message-2')
        )
      ).toBe(true)
    )

    await user.click(screen.getByText('message-content:topic-message-1'))
    await waitFor(() => expect(mocks.onOpenMessage).toHaveBeenCalledWith('topic-message-1'))

    await user.click(screen.getByRole('button', { name: 'Open' }))
    await waitFor(() => expect(mocks.onOpenMessage).toHaveBeenLastCalledWith('topic-message-1'))

    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(mocks.onClose).toHaveBeenCalledTimes(1)
  })

  it('loads the anchored session preview page without auto-loading more context', async () => {
    mocks.topicPages = []
    mocks.sessionHasNext = true
    mocks.sessionPages = [
      {
        items: [createSessionMessage()],
        nextCursor: 'cursor-1'
      }
    ]

    renderPreview(SESSION_TARGET)

    expect(await screen.findByText('message-content:session-message-1')).toBeInTheDocument()
    expect(screen.getByText('Session A')).toBeInTheDocument()
    expect(screen.getByText('Task messages')).toBeInTheDocument()
    expect(mocks.useInfiniteQuery).toHaveBeenCalledWith(
      '/agent-sessions/:sessionId/messages',
      expect.objectContaining({
        params: { sessionId: 'session-1' },
        limit: expect.any(Number),
        enabled: true
      })
    )
    const sessionQueryOptions = vi
      .mocked(mocks.useInfiniteQuery)
      .mock.calls.find(([path]) => path === '/agent-sessions/:sessionId/messages')?.[1] as Record<string, unknown>
    expect(sessionQueryOptions).toMatchObject({
      query: { messageId: 'session-message-1' }
    })
    // Anchored at the matched message; older context is never auto-paginated even when available.
    expect(mocks.sessionLoadNext).not.toHaveBeenCalled()
  })

  it('loads an older session page when the user scrolls near the top', async () => {
    mocks.topicPages = []
    mocks.sessionHasNext = true
    mocks.sessionPages = [
      {
        items: [createSessionMessage()],
        nextCursor: 'cursor-1'
      }
    ]

    const { container } = renderPreview(SESSION_TARGET)

    await screen.findByText('message-content:session-message-1')
    const scroller = container.querySelector('.overflow-y-auto') as HTMLElement

    setScrollGeometry(scroller, { scrollTop: 1000, scrollHeight: 4000 })
    fireEvent.scroll(scroller)
    expect(mocks.sessionLoadNext).not.toHaveBeenCalled()

    setScrollGeometry(scroller, { scrollTop: 0, scrollHeight: 4000 })
    fireEvent.scroll(scroller)
    expect(mocks.sessionLoadNext).toHaveBeenCalledTimes(1)
  })

  it('loads an older topic page when the user scrolls near the top', async () => {
    mocks.topicHasNext = true

    const { container } = renderPreview()

    await screen.findByText('message-content:topic-message-2')
    const scroller = container.querySelector('.overflow-y-auto') as HTMLElement

    setScrollGeometry(scroller, { scrollTop: 0, scrollHeight: 4000 })
    fireEvent.scroll(scroller)
    expect(mocks.topicLoadNext).toHaveBeenCalledTimes(1)
  })

  it('keeps the older-page scroll anchor while the loading spinner is visible', async () => {
    mocks.topicHasNext = true

    const props = createPreviewProps()
    const { container, rerender } = render(<GlobalSearchMessagePreviewPanel {...props} />)

    await screen.findByText('message-content:topic-message-2')
    const scroller = container.querySelector('.overflow-y-auto') as HTMLElement

    setScrollGeometry(scroller, { scrollTop: 0, scrollHeight: 4000 })
    fireEvent.scroll(scroller)
    expect(mocks.topicLoadNext).toHaveBeenCalledTimes(1)

    mocks.topicIsRefreshing = true
    setScrollGeometry(scroller, { scrollTop: 0, scrollHeight: 4020 })
    rerender(<GlobalSearchMessagePreviewPanel {...props} />)
    expect(scroller.scrollTop).toBe(20)

    mocks.topicIsRefreshing = false
    mocks.topicPages = [
      ...mocks.topicPages,
      {
        items: [
          createTopicMessage({
            id: 'topic-message-older',
            data: { parts: [{ type: 'text', text: 'older' }] },
            createdAt: '2025-12-31T23:59:59.000Z',
            updatedAt: '2025-12-31T23:59:59.000Z'
          })
        ]
      }
    ]
    setScrollGeometry(scroller, { scrollTop: 20, scrollHeight: 4600 })
    rerender(<GlobalSearchMessagePreviewPanel {...props} />)
    expect(scroller.scrollTop).toBe(600)
  })

  it('mounts and highlights only the virtual range plus the active target', async () => {
    mocks.topicPages = [
      {
        items: Array.from({ length: 150 }, (_, index) =>
          createTopicMessage({
            id: `topic-message-${index}`,
            createdAt: `2026-01-01T00:00:${String(index).padStart(2, '0')}.000Z`,
            updatedAt: `2026-01-01T00:00:${String(index).padStart(2, '0')}.000Z`
          })
        )
      }
    ]
    mocks.virtualRangeEnd = 2

    renderPreview({ ...TOPIC_TARGET, messageId: 'topic-message-149' })

    await waitFor(() => expect(screen.getAllByText(/^message-content:/)).toHaveLength(4))
    expect(screen.getByText('message-content:topic-message-149')).toBeInTheDocument()
    expect(screen.queryByText('message-content:topic-message-3')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByText('needle', { selector: 'mark' })).toHaveLength(4))
    expect(mocks.virtualScrollToIndex).toHaveBeenCalledWith(149, { align: 'center' })
  })

  it('keeps loaded preview messages visible and allows retry when loading older messages fails', async () => {
    mocks.topicHasNext = true

    const props = createPreviewProps()
    const { container, rerender } = render(<GlobalSearchMessagePreviewPanel {...props} />)

    expect(await screen.findByText('message-content:topic-message-1')).toBeInTheDocument()
    expect(screen.getByText('message-content:topic-message-2')).toBeInTheDocument()
    const scroller = container.querySelector('.overflow-y-auto') as HTMLElement

    setScrollGeometry(scroller, { scrollTop: 0, scrollHeight: 4000 })
    fireEvent.scroll(scroller)
    expect(mocks.topicLoadNext).toHaveBeenCalledTimes(1)

    mocks.topicIsRefreshing = true
    setScrollGeometry(scroller, { scrollTop: 0, scrollHeight: 4020 })
    rerender(<GlobalSearchMessagePreviewPanel {...props} />)

    mocks.topicIsRefreshing = false
    mocks.topicError = new Error('older page failed')
    setScrollGeometry(scroller, { scrollTop: 20, scrollHeight: 4020 })
    rerender(<GlobalSearchMessagePreviewPanel {...props} />)

    expect(screen.getByRole('alert')).toHaveTextContent('Search failed')

    setScrollGeometry(scroller, { scrollTop: 0, scrollHeight: 4020 })
    fireEvent.scroll(scroller)
    expect(mocks.topicLoadNext).toHaveBeenCalledTimes(2)
  })

  it('cancels a pending active-message auto-scroll frame on unmount', async () => {
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(42)
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)

    try {
      const { unmount } = renderPreview()

      await screen.findByText('message-content:topic-message-2')
      unmount()

      expect(requestFrame).toHaveBeenCalled()
      expect(cancelFrame).toHaveBeenCalledWith(42)
    } finally {
      requestFrame.mockRestore()
      cancelFrame.mockRestore()
    }
  })

  it('does not load older pages on scroll when there are none left', async () => {
    mocks.topicHasNext = false

    const { container } = renderPreview()

    await screen.findByText('message-content:topic-message-2')
    const scroller = container.querySelector('.overflow-y-auto') as HTMLElement

    setScrollGeometry(scroller, { scrollTop: 0, scrollHeight: 4000 })
    fireEvent.scroll(scroller)
    expect(mocks.topicLoadNext).not.toHaveBeenCalled()
  })

  it('uses the system role label for system preview messages', async () => {
    mocks.topicPages = [
      {
        items: [
          createTopicMessage({
            id: 'topic-message-system',
            role: 'system',
            data: { parts: [{ type: 'text', text: 'system prompt' }] }
          })
        ]
      }
    ]

    renderPreview({ ...TOPIC_TARGET, messageId: 'topic-message-system' })

    expect(await screen.findByText('System')).toBeInTheDocument()
    expect(screen.queryByText('User')).not.toBeInTheDocument()
  })

  it('uses the tool role label for tool preview messages', async () => {
    mocks.topicPages = [
      {
        items: [
          createTopicMessage({
            id: 'topic-message-tool',
            role: 'tool',
            data: { parts: [{ type: 'text', text: 'tool output' }] }
          })
        ]
      }
    ]

    renderPreview({ ...TOPIC_TARGET, messageId: 'topic-message-tool' })

    expect(await screen.findByText('Tool')).toBeInTheDocument()
    expect(screen.queryByText('User')).not.toBeInTheDocument()
  })
})
