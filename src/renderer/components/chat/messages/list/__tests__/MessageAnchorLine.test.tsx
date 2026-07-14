// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type { CherryMessagePart } from '@shared/data/types/message'
import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { MessageListItem } from '../../types'
import MessageAnchorLine from '../MessageAnchorLine'

const partsMap: Record<string, CherryMessagePart[]> = {}

vi.mock('../../blocks/MessagePartsContext', () => ({
  usePartsMap: () => partsMap
}))

function makeMessage(overrides: Partial<MessageListItem> & Pick<MessageListItem, 'id' | 'role'>): MessageListItem {
  return {
    topicId: 'topic-1',
    parentId: null,
    createdAt: '2026-07-02T00:00:00.000Z',
    status: 'success',
    ...overrides
  }
}

const messages: MessageListItem[] = [
  makeMessage({ id: 'user-1', role: 'user' }),
  makeMessage({ id: 'assistant-1', role: 'assistant', parentId: 'user-1' }),
  makeMessage({ id: 'user-2', role: 'user' }),
  makeMessage({ id: 'assistant-2', role: 'assistant', parentId: 'user-2' }),
  makeMessage({ id: 'assistant-2b', role: 'assistant', parentId: 'user-2' })
]

describe('MessageAnchorLine', () => {
  it('keeps the anchor rail scoped inside the message list layer', () => {
    const { container } = render(<MessageAnchorLine messages={messages} />)

    const anchorRail = container.firstElementChild
    expect(anchorRail).toHaveClass('absolute', 'z-20')
    expect(anchorRail).not.toHaveClass('fixed', 'z-999')
  })

  it('renders one tick per conversation turn', () => {
    const { container } = render(<MessageAnchorLine messages={messages} />)

    expect(container.querySelectorAll('[data-message-anchor-tick]')).toHaveLength(2)
  })

  it('marks the turn containing the active message', () => {
    const { container } = render(<MessageAnchorLine messages={messages} activeMessageId="assistant-1" />)

    const ticks = container.querySelectorAll('[data-message-anchor-tick]')
    expect(ticks[0]).toHaveAttribute('data-active', 'true')
    expect(ticks[1]).toHaveAttribute('data-active', 'false')
  })

  it('defaults the active tick to the last turn', () => {
    const { container } = render(<MessageAnchorLine messages={messages} />)

    const ticks = container.querySelectorAll('[data-message-anchor-tick]')
    expect(ticks[1]).toHaveAttribute('data-active', 'true')
  })

  it('scrolls to the turn start message on tick click', () => {
    const scrollToMessageId = vi.fn()
    const { container } = render(<MessageAnchorLine messages={messages} scrollToMessageId={scrollToMessageId} />)

    const ticks = container.querySelectorAll('[data-message-anchor-tick]')
    fireEvent.click(ticks[1])

    expect(scrollToMessageId).toHaveBeenCalledWith('user-2')
  })

  it('renders nothing without messages', () => {
    const { container } = render(<MessageAnchorLine messages={[]} />)

    expect(container.firstElementChild).toBeNull()
  })
})
