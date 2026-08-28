import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import type { ReactNode } from 'react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import MessageNavigation from '../MessageNavigation'
import {
  createMessage,
  createScrollContainerRef,
  renderNavigation,
  setRect,
  showNavigation
} from './messageNavigationTestHarness'

const navigationButtonNames = {
  bottom: 'Back to bottom',
  next: 'Next Message',
  prev: 'Previous Message',
  top: 'Back to top'
} as const
const fourUserMessages = [
  createMessage('user-1', 'user'),
  createMessage('user-2', 'user'),
  createMessage('user-3', 'user'),
  createMessage('user-4', 'user')
]
const originalLanguage = i18n.language

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

beforeAll(async () => {
  await i18n.changeLanguage('en-US')
})

afterAll(async () => {
  await i18n.changeLanguage(originalLanguage)
})

const renderVisibleNavigation = (...args: Parameters<typeof renderNavigation>) => {
  const result = renderNavigation(...args)
  showNavigation(result.scrollContainer)
  return result
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
          getNavigationBaseMessageId={() => null}
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

    const navigation =
      screen.getByRole('button', { name: navigationButtonNames.top }).parentElement?.parentElement ?? null
    expect(container).toContainElement(navigation)
    expect(navigation).toHaveStyle({ opacity: '1' })
  })

  it('navigates previous to older and next to newer messages from the full message list', async () => {
    const user = userEvent.setup()
    const messages = [
      createMessage('user-1', 'user'),
      createMessage('assistant-1', 'assistant'),
      createMessage('user-2', 'user'),
      createMessage('assistant-2', 'assistant'),
      createMessage('user-3', 'user')
    ]

    const { scrollContainer, scrollToMessageId } = renderNavigation(messages, ['user-2'])
    showNavigation(scrollContainer)

    await user.click(screen.getByRole('button', { name: navigationButtonNames.prev }))

    expect(scrollToMessageId).toHaveBeenCalledWith('user-1')

    scrollToMessageId.mockClear()
    await user.click(screen.getByRole('button', { name: navigationButtonNames.next }))

    expect(scrollToMessageId).toHaveBeenCalledWith('user-3')
  })

  it('delegates the top and bottom buttons to the runtime scroll callbacks', async () => {
    const user = userEvent.setup()
    const { scrollContainer, scrollToBottom, scrollToTop } = renderNavigation([createMessage('user-1', 'user')])
    showNavigation(scrollContainer)

    await user.click(screen.getByRole('button', { name: navigationButtonNames.top }))
    expect(scrollToTop).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: navigationButtonNames.bottom }))
    expect(scrollToBottom).toHaveBeenCalledTimes(1)
  })

  it('moves one message at a time from the first visible user message', async () => {
    const user = userEvent.setup()
    const { scrollToMessageId } = renderVisibleNavigation(fourUserMessages, ['user-2', 'user-3'])

    await user.click(screen.getByRole('button', { name: navigationButtonNames.prev }))
    expect(scrollToMessageId).toHaveBeenCalledWith('user-1')

    scrollToMessageId.mockClear()
    await user.click(screen.getByRole('button', { name: navigationButtonNames.next }))
    expect(scrollToMessageId).toHaveBeenCalledWith('user-3')
  })

  it.each<{
    actions: ('prev' | 'next')[]
    expectedMessageIds: string[]
    name: string
    visibleMessageId: string
  }>([
    {
      actions: ['prev', 'prev', 'prev'],
      expectedMessageIds: ['user-3', 'user-2', 'user-1'],
      name: 'upward through consecutive turns',
      visibleMessageId: 'user-4'
    },
    {
      actions: ['next', 'next', 'next'],
      expectedMessageIds: ['user-2', 'user-3', 'user-4'],
      name: 'downward through consecutive turns',
      visibleMessageId: 'user-1'
    },
    {
      actions: ['prev', 'next'],
      expectedMessageIds: ['user-2', 'user-3'],
      name: 'in reverse from the latest semantic base',
      visibleMessageId: 'user-3'
    }
  ])('moves $name before scrolling settles', async ({ actions, expectedMessageIds, visibleMessageId }) => {
    const user = userEvent.setup()
    let navigationBaseMessageId: string | null = null
    const { scrollToMessageId } = renderVisibleNavigation(
      fourUserMessages,
      [visibleMessageId],
      () => navigationBaseMessageId,
      (messageId) => {
        navigationBaseMessageId = messageId
      }
    )

    for (const action of actions) {
      await user.click(screen.getByRole('button', { name: navigationButtonNames[action] }))
    }

    expect(scrollToMessageId.mock.calls.map(([messageId]) => messageId)).toEqual(expectedMessageIds)
  })

  it('falls back to the visible turn after explicit navigation ownership is cleared', async () => {
    const user = userEvent.setup()
    let navigationBaseMessageId: string | null = 'user-3'
    const { scrollToMessageId } = renderVisibleNavigation(fourUserMessages, ['user-4'], () => navigationBaseMessageId)

    await user.click(screen.getByRole('button', { name: navigationButtonNames.prev }))
    expect(scrollToMessageId).toHaveBeenLastCalledWith('user-2')

    navigationBaseMessageId = null
    setRect(document.getElementById('message-user-4') as HTMLElement, { bottom: -100, height: 100, top: -200 })
    setRect(document.getElementById('message-user-2') as HTMLElement, { bottom: 220, height: 100, top: 120 })

    await user.click(screen.getByRole('button', { name: navigationButtonNames.prev }))
    expect(scrollToMessageId).toHaveBeenLastCalledWith('user-1')
  })

  it('uses the assistant reply owner when only that reply is visible', async () => {
    const user = userEvent.setup()
    const messages = [
      createMessage('user-1', 'user'),
      createMessage('assistant-1a', 'assistant', 'user-1'),
      createMessage('assistant-1b', 'assistant', 'user-1'),
      createMessage('user-2', 'user'),
      createMessage('assistant-2', 'assistant', 'user-2'),
      createMessage('user-3', 'user')
    ]
    const { scrollToMessageId } = renderVisibleNavigation(messages, ['assistant-1b'])

    await user.click(screen.getByRole('button', { name: navigationButtonNames.next }))

    expect(scrollToMessageId).toHaveBeenCalledWith('user-2')
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
  ])('delegates next-message fallback to runtime scrollToBottom $name', async ({ messages, visibleMessageIds }) => {
    const user = userEvent.setup()
    const { scrollToBottom, scrollToMessageId, scrollToTop } = renderVisibleNavigation(messages, visibleMessageIds)

    await user.click(screen.getByRole('button', { name: navigationButtonNames.next }))

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
  ])('delegates prev-message fallback to runtime scrollToTop $name', async ({ messages, visibleMessageIds }) => {
    const user = userEvent.setup()
    const { scrollToBottom, scrollToMessageId, scrollToTop } = renderVisibleNavigation(messages, visibleMessageIds)

    await user.click(screen.getByRole('button', { name: navigationButtonNames.prev }))

    expect(scrollToTop).toHaveBeenCalledTimes(1)
    expect(scrollToBottom).not.toHaveBeenCalled()
    expect(scrollToMessageId).not.toHaveBeenCalled()
  })
})
