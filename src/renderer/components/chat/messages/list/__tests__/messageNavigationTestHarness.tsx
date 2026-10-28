import { fireEvent, render } from '@testing-library/react'
import { vi } from 'vitest'

import type { MessageListItem } from '../../types'
import MessageNavigation from '../MessageNavigation'

export const createMessage = (
  id: string,
  role: MessageListItem['role'],
  parentId?: string | null
): MessageListItem => ({
  id,
  role,
  parentId,
  topicId: 'topic-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  status: 'success'
})

export const createScrollContainerRef = () => ({ current: null as HTMLDivElement | null })

export const setRect = (element: Element, rect: Partial<DOMRect>) => {
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

export const renderNavigation = (
  messages: MessageListItem[],
  visibleMessageIds: string[] = [],
  getNavigationBaseMessageId: () => string | null = () => null,
  onScrollToMessageId?: (messageId: string) => void
) => {
  const scrollContainerRef = createScrollContainerRef()
  const scrollToMessageId = vi.fn(onScrollToMessageId)
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
        getNavigationBaseMessageId={getNavigationBaseMessageId}
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
    left: 0,
    right: 500,
    top: 0,
    width: 500
  })
  for (const message of messages) {
    setRect(document.getElementById(`message-${message.id}`) as HTMLElement, {
      bottom: visibleMessageIds.includes(message.id) ? 220 : -100,
      height: 100,
      top: visibleMessageIds.includes(message.id) ? 120 : -200
    })
  }

  return { scrollContainer: scrollContainerRef.current!, scrollToBottom, scrollToMessageId, scrollToTop }
}

export const showNavigation = (scrollContainer: HTMLElement) => {
  fireEvent.mouseMove(scrollContainer, { clientX: 470, clientY: 250 })
}
