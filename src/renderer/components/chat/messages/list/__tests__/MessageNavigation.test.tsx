import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { MessageListItem } from '../../types'
import MessageNavigation from '../MessageNavigation'

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: { children: ReactNode }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({
    setTimeoutTimer: vi.fn(),
    clearTimeoutTimer: vi.fn()
  })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

const createMessage = (id: string, role: MessageListItem['role']): MessageListItem => ({
  id,
  role,
  topicId: 'topic-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  status: 'success'
})

const createScrollContainerRef = () => ({ current: null as HTMLDivElement | null })

const setRect = (element: Element, rect: Partial<DOMRect>) => {
  element.getBoundingClientRect = vi.fn(() => ({
    bottom: 0,
    height: 0,
    left: 0,
    right: 0,
    top: 0,
    width: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
    ...rect
  }))
}

const renderNavigation = (messages: MessageListItem[], visibleMessageIds: string[] = []) => {
  const scrollContainerRef = createScrollContainerRef()
  const scrollToMessageId = vi.fn()
  const scrollToTop = vi.fn()
  const scrollToBottom = vi.fn()

  const { container } = render(
    <>
      <div id="messages">
        <div ref={scrollContainerRef} data-message-virtual-list-scroller>
          {messages.map((message) => (
            <div key={message.id} id={`message-${message.id}`} />
          ))}
        </div>
      </div>
      <MessageNavigation
        scrollContainerRef={scrollContainerRef}
        getMessageElement={(messageId) => document.getElementById(`message-${messageId}`)}
        messages={messages}
        scrollToMessageId={scrollToMessageId}
        scrollToTop={scrollToTop}
        scrollToBottom={scrollToBottom}
      />
    </>
  )

  setRect(container.querySelector('[data-message-virtual-list-scroller]') as HTMLElement, {
    bottom: 500,
    height: 500,
    top: 0
  })
  for (const message of messages) {
    setRect(document.getElementById(`message-${message.id}`) as HTMLElement, {
      bottom: visibleMessageIds.includes(message.id) ? 220 : -100,
      height: 100,
      top: visibleMessageIds.includes(message.id) ? 120 : -200
    })
  }

  return { scrollToBottom, scrollToMessageId, scrollToTop }
}

describe('MessageNavigation', () => {
  it('uses the owning message list when another mounted list has the same container id', () => {
    const scrollContainerRef = createScrollContainerRef()
    const { container } = render(
      <>
        <div id="messages" data-testid="background-message-list">
          <div data-message-virtual-list-scroller />
        </div>
        <div id="messages" data-testid="active-message-list">
          <div ref={scrollContainerRef} data-testid="active-message-scroller" data-message-virtual-list-scroller />
        </div>
        <MessageNavigation
          scrollContainerRef={scrollContainerRef}
          getMessageElement={() => null}
          messages={[createMessage('user-1', 'user')]}
          scrollToMessageId={vi.fn()}
          scrollToTop={vi.fn()}
          scrollToBottom={vi.fn()}
        />
      </>
    )

    setRect(screen.getByTestId('background-message-list'), {
      bottom: 0,
      height: 0,
      right: 0,
      top: 0
    })
    setRect(screen.getByTestId('active-message-scroller'), {
      bottom: 600,
      height: 600,
      left: 100,
      right: 700,
      top: 0,
      width: 600
    })

    fireEvent.mouseMove(screen.getByTestId('active-message-list'), { clientX: 670, clientY: 300 })

    const navigation = screen.getByRole('button', { name: 'chat.navigation.top' }).parentElement?.parentElement ?? null
    expect(container).toContainElement(navigation)
    expect(navigation).toHaveStyle({ opacity: '1' })
  })

  it('navigates previous to older and next to newer messages from the full message list', () => {
    const scrollContainerRef = createScrollContainerRef()
    const scrollToMessageId = vi.fn()
    const messages = [
      createMessage('user-1', 'user'),
      createMessage('assistant-1', 'assistant'),
      createMessage('user-2', 'user'),
      createMessage('assistant-2', 'assistant'),
      createMessage('user-3', 'user')
    ]

    const { container } = render(
      <>
        <div id="messages">
          <div ref={scrollContainerRef} data-message-virtual-list-scroller>
            <div id="message-user-2" />
          </div>
        </div>
        <MessageNavigation
          scrollContainerRef={scrollContainerRef}
          getMessageElement={(messageId) => document.getElementById(`message-${messageId}`)}
          messages={messages}
          scrollToMessageId={scrollToMessageId}
          scrollToTop={vi.fn()}
          scrollToBottom={vi.fn()}
        />
      </>
    )

    setRect(container.querySelector('[data-message-virtual-list-scroller]') as HTMLElement, {
      bottom: 500,
      height: 500,
      top: 0
    })
    setRect(document.getElementById('message-user-2') as HTMLElement, {
      bottom: 260,
      height: 80,
      top: 180
    })

    fireEvent.click(screen.getByRole('button', { name: 'chat.navigation.prev' }))

    expect(scrollToMessageId).toHaveBeenCalledWith('user-1')

    scrollToMessageId.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'chat.navigation.next' }))

    expect(scrollToMessageId).toHaveBeenCalledWith('user-3')
  })

  it('delegates the top and bottom buttons to the runtime scroll callbacks', () => {
    const scrollContainerRef = createScrollContainerRef()
    const scrollToTop = vi.fn()
    const scrollToBottom = vi.fn()

    render(
      <>
        <div id="messages">
          <div ref={scrollContainerRef} data-message-virtual-list-scroller />
        </div>
        <MessageNavigation
          scrollContainerRef={scrollContainerRef}
          getMessageElement={() => null}
          messages={[createMessage('user-1', 'user')]}
          scrollToMessageId={vi.fn()}
          scrollToTop={scrollToTop}
          scrollToBottom={scrollToBottom}
        />
      </>
    )

    fireEvent.click(screen.getByRole('button', { name: 'chat.navigation.top' }))
    expect(scrollToTop).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'chat.navigation.bottom' }))
    expect(scrollToBottom).toHaveBeenCalledTimes(1)
  })

  it('moves one message at a time from the first visible user message', () => {
    const messages = [
      createMessage('user-1', 'user'),
      createMessage('user-2', 'user'),
      createMessage('user-3', 'user'),
      createMessage('user-4', 'user')
    ]
    const { scrollToMessageId } = renderNavigation(messages, ['user-2', 'user-3'])

    fireEvent.click(screen.getByRole('button', { name: 'chat.navigation.prev' }))
    expect(scrollToMessageId).toHaveBeenCalledWith('user-1')

    scrollToMessageId.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'chat.navigation.next' }))
    expect(scrollToMessageId).toHaveBeenCalledWith('user-3')
  })

  it.each([
    {
      name: 'when there are no messages',
      messages: []
    },
    {
      name: 'when no message is visible',
      messages: [createMessage('user-1', 'user'), createMessage('user-2', 'user')]
    },
    {
      name: 'when the last user message is already visible',
      messages: [createMessage('user-1', 'user'), createMessage('user-2', 'user')],
      visibleMessageIds: ['user-2']
    }
  ])('delegates next-message fallback to runtime scrollToBottom $name', ({ messages, visibleMessageIds }) => {
    const { scrollToBottom, scrollToMessageId, scrollToTop } = renderNavigation(messages, visibleMessageIds)

    fireEvent.click(screen.getByRole('button', { name: 'chat.navigation.next' }))

    expect(scrollToBottom).toHaveBeenCalledTimes(1)
    expect(scrollToTop).not.toHaveBeenCalled()
    expect(scrollToMessageId).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: 'when there are no messages',
      messages: []
    },
    {
      name: 'when no message is visible',
      messages: [createMessage('user-1', 'user'), createMessage('user-2', 'user')]
    },
    {
      name: 'when the first user message is already visible',
      messages: [createMessage('user-1', 'user'), createMessage('user-2', 'user')],
      visibleMessageIds: ['user-1']
    }
  ])('delegates prev-message fallback to runtime scrollToTop $name', ({ messages, visibleMessageIds }) => {
    const { scrollToBottom, scrollToMessageId, scrollToTop } = renderNavigation(messages, visibleMessageIds)

    fireEvent.click(screen.getByRole('button', { name: 'chat.navigation.prev' }))

    expect(scrollToTop).toHaveBeenCalledTimes(1)
    expect(scrollToBottom).not.toHaveBeenCalled()
    expect(scrollToMessageId).not.toHaveBeenCalled()
  })
})
