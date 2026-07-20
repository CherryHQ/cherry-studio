import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MessageListItem } from '../../messages/types'
import { useMessageEnterMotionIds } from '../messageEnterMotion'

const createMessage = (id: string): MessageListItem => ({
  id,
  role: 'user',
  topicId: 'topic-1',
  createdAt: '2026-01-01T00:00:00Z',
  status: 'success'
})

function MotionHarness({
  messages,
  scopeKey = 'topic-1'
}: {
  messages: readonly MessageListItem[]
  scopeKey?: string
}) {
  const enteringMessageIds = useMessageEnterMotionIds({ messages, scopeKey })
  return <span data-testid="entering-message-ids">{Array.from(enteringMessageIds).join(',')}</span>
}

describe('useMessageEnterMotionIds', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('tracks newly appended messages and clears them after the motion duration', () => {
    vi.useFakeTimers()
    const messageB = createMessage('b')
    const view = render(<MotionHarness messages={[messageB]} />)

    view.rerender(<MotionHarness messages={[messageB, createMessage('a')]} />)

    expect(screen.getByTestId('entering-message-ids')).toHaveTextContent('a')

    act(() => {
      vi.advanceTimersByTime(380)
    })
    expect(screen.getByTestId('entering-message-ids')).toBeEmptyDOMElement()
  })

  it('clears entering messages when the list scope changes', () => {
    const messageB = createMessage('b')
    const messages = [messageB, createMessage('a')]
    const view = render(<MotionHarness messages={[messageB]} />)

    view.rerender(<MotionHarness messages={messages} />)
    expect(screen.getByTestId('entering-message-ids')).toHaveTextContent('a')

    view.rerender(<MotionHarness messages={messages} scopeKey="topic-2" />)
    expect(screen.getByTestId('entering-message-ids')).toBeEmptyDOMElement()
  })
})
