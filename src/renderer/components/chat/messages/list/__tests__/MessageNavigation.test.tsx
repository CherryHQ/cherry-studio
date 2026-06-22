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

describe('MessageNavigation', () => {
  it('scrolls to message ids from the full message list, not only rendered DOM nodes', () => {
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
          <div data-message-virtual-list-scroller>
            <div id="message-user-2" />
          </div>
        </div>
        <MessageNavigation containerId="messages" messages={messages} scrollToMessageId={scrollToMessageId} />
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

    expect(scrollToMessageId).toHaveBeenCalledWith('user-3')
  })
})
