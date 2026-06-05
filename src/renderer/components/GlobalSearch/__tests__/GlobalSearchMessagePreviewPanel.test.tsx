// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { render, screen, waitFor } from '@testing-library/react'
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
  topicLoadNext: vi.fn(),
  sessionLoadNext: vi.fn(),
  useInfiniteQuery: vi.fn(),
  onClose: vi.fn(),
  onOpenMessage: vi.fn()
}))

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
    const orderedPages = options?.reversePages ? [...pages].reverse() : pages
    return orderedPages.flatMap((page) => (options?.reverseItems ? [...page.items].reverse() : page.items))
  }
}))

function mockPreviewInfiniteQuery(path: string) {
  if (path === '/topics/:topicId/messages') {
    return {
      pages: mocks.topicPages,
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      hasNext: mocks.topicHasNext,
      loadNext: mocks.topicLoadNext
    }
  }

  return {
    pages: mocks.sessionPages,
    isLoading: false,
    isRefreshing: false,
    error: undefined,
    hasNext: mocks.sessionHasNext,
    loadNext: mocks.sessionLoadNext
  }
}

vi.mock('@renderer/components/chat/messages/MessageContentProvider', () => ({
  MessageContentProvider: ({ children, topic }: { children: ReactNode; topic: { assistantId: string | null } }) => (
    <div data-testid="preview-provider" data-topic-assistant-id={String(topic.assistantId)}>
      {children}
    </div>
  )
}))

vi.mock('@renderer/components/chat/messages/frame/MessageContent', () => ({
  default: ({ message }: any) => (
    <div>
      <span>message-content:{message.id}</span>
      <span> needle</span>
    </div>
  )
}))

vi.mock('@renderer/utils', () => ({
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
        'globalSearch.messageSearch.roles.user': 'User',
        'globalSearch.messageSearch.sources.session': 'Work messages',
        'globalSearch.messageSearch.sources.topic': 'Topic messages'
      })[key] ?? key
  })
}))

import { GlobalSearchMessagePreviewPanel } from '../GlobalSearchMessagePreviewPanel'

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
          {
            message: {
              id: 'topic-message-1',
              topicId: 'topic-1',
              parentId: null,
              role: 'user',
              data: { parts: [{ type: 'text', text: 'hello' }] },
              status: 'success',
              siblingsGroupId: 0,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z'
            }
          },
          {
            message: {
              id: 'topic-message-2',
              topicId: 'topic-1',
              parentId: 'topic-message-1',
              role: 'assistant',
              data: { parts: [{ type: 'text', text: 'reply' }] },
              status: 'success',
              siblingsGroupId: 0,
              createdAt: '2026-01-01T00:00:01.000Z',
              updatedAt: '2026-01-01T00:00:01.000Z'
            }
          }
        ]
      }
    ]
    mocks.sessionPages = []
    mocks.topicHasNext = false
    mocks.sessionHasNext = false
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

    render(
      <GlobalSearchMessagePreviewPanel
        searchQuery="needle"
        target={{
          sourceType: 'topic',
          topicId: 'topic-1',
          title: 'Topic A',
          messageId: 'topic-message-2',
          assistantId: null
        }}
        onClose={mocks.onClose}
        onOpenMessage={mocks.onOpenMessage}
      />
    )

    expect(screen.getByText('Topic A')).toBeInTheDocument()
    expect(screen.getByText('Topic messages')).toBeInTheDocument()
    expect(screen.getByTestId('preview-provider')).toHaveAttribute('data-topic-assistant-id', 'null')
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

  it('anchors session preview at the target message and continues loading available context', async () => {
    vi.mocked(mocks.sessionLoadNext).mockClear()
    mocks.topicPages = []
    mocks.sessionHasNext = true
    mocks.sessionPages = [
      {
        items: [
          {
            id: 'session-message-1',
            sessionId: 'session-1',
            role: 'assistant',
            data: { parts: [{ type: 'text', text: 'session reply' }] },
            status: 'success',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            modelId: null,
            modelSnapshot: null,
            traceId: null,
            stats: null,
            runtimeResumeToken: null,
            searchableText: 'session reply'
          }
        ],
        nextCursor: 'cursor-1'
      }
    ]

    vi.mocked(mocks.sessionLoadNext).mockImplementation(() => undefined)

    render(
      <GlobalSearchMessagePreviewPanel
        searchQuery="needle"
        target={{
          sourceType: 'session',
          sessionId: 'session-1',
          title: 'Session A',
          messageId: 'session-message-1'
        }}
        onClose={mocks.onClose}
        onOpenMessage={mocks.onOpenMessage}
      />
    )

    expect(screen.getByText('Session A')).toBeInTheDocument()
    expect(screen.getByText('Work messages')).toBeInTheDocument()
    await waitFor(() => expect(mocks.sessionLoadNext).toHaveBeenCalledTimes(1))
    expect(mocks.useInfiniteQuery).toHaveBeenCalledWith(
      '/sessions/:sessionId/messages',
      expect.objectContaining({
        params: { sessionId: 'session-1' },
        query: { messageId: 'session-message-1' },
        limit: expect.any(Number),
        enabled: true
      })
    )
  })
})
