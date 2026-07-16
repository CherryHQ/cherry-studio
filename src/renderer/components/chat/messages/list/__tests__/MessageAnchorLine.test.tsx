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
  makeMessage({ id: 'assistant-2b', role: 'assistant', parentId: 'user-2' }),
  makeMessage({ id: 'user-3', role: 'user' }),
  makeMessage({ id: 'assistant-3', role: 'assistant', parentId: 'user-3' }),
  makeMessage({ id: 'user-4', role: 'user' }),
  makeMessage({ id: 'assistant-4', role: 'assistant', parentId: 'user-4' }),
  makeMessage({ id: 'user-5', role: 'user' }),
  makeMessage({ id: 'assistant-5', role: 'assistant', parentId: 'user-5' })
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

    expect(container.querySelectorAll('[data-message-anchor-tick]')).toHaveLength(5)
  })

  it('renders nothing with fewer than five turns — no anchoring needed', () => {
    const { container } = render(<MessageAnchorLine messages={messages.slice(0, 5)} />)

    expect(container.firstElementChild).toBeNull()
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
    expect(ticks[4]).toHaveAttribute('data-active', 'true')
  })

  it('scrolls to the turn start message on tick click', () => {
    const scrollToMessageId = vi.fn()
    const { container } = render(<MessageAnchorLine messages={messages} scrollToMessageId={scrollToMessageId} />)

    const ticks = container.querySelectorAll('[data-message-anchor-tick]')
    fireEvent.click(ticks[1])

    expect(scrollToMessageId).toHaveBeenCalledWith('user-2')
  })

  it('gives every tick the same constant pitch inside a scrollable rail', () => {
    const { container } = render(<MessageAnchorLine messages={messages} />)

    // Constant pitch (never varies with the turn count) and the rail can scroll
    // once the ticks overflow it.
    expect(container.querySelector('.overflow-y-auto')).not.toBeNull()
    const ticks = Array.from(container.querySelectorAll<HTMLElement>('[data-message-anchor-tick]'))
    const heights = new Set(ticks.map((tick) => tick.style.height))
    expect(heights).toEqual(new Set(['10px']))
  })

  it('runs the rail the full message-area height rather than insetting above the composer', () => {
    const { container } = render(<MessageAnchorLine messages={messages} />)

    // The rail spans top-to-bottom; the composer sits to the left of this gutter.
    expect(container.firstElementChild).toHaveClass('top-2.5', 'bottom-8')
    expect((container.firstElementChild as HTMLElement).style.bottom).toBe('')
  })

  it('fades the top edge as a hint while older pages remain unloaded', () => {
    const { container } = render(<MessageAnchorLine messages={messages} hasOlder />)

    const scroll = container.querySelector<HTMLElement>('.overflow-y-auto')
    expect(scroll?.style.maskImage).toContain('transparent 0%')
  })

  it('keeps the top edge solid when fully loaded and unscrolled', () => {
    const { container } = render(<MessageAnchorLine messages={messages} />)

    const scroll = container.querySelector<HTMLElement>('.overflow-y-auto')
    expect(scroll?.style.maskImage ?? 'black 0%').toContain('black 0%')
  })

  it('renders nothing without messages', () => {
    const { container } = render(<MessageAnchorLine messages={[]} />)

    expect(container.firstElementChild).toBeNull()
  })
})
