import { AssistantMessageStatus, type Message, UserMessageStatus } from '@renderer/types/newMessage'
import { describe, expect, it } from 'vitest'

import { paginateMessages } from '../pagination'

const createMessage = (id: string, role: Message['role'], askId?: string): Message => ({
  id,
  role,
  askId,
  assistantId: 'assistant',
  topicId: 'topic',
  createdAt: '2026-01-01T00:00:00.000Z',
  status: role === 'user' ? UserMessageStatus.SUCCESS : AssistantMessageStatus.SUCCESS,
  blocks: []
})

describe('paginateMessages', () => {
  it('advances through normal pages without gaps or duplicates', () => {
    const messages = [
      createMessage('user-1', 'user'),
      createMessage('assistant-1', 'assistant', 'user-1'),
      createMessage('user-2', 'user'),
      createMessage('assistant-2', 'assistant', 'user-2'),
      createMessage('user-3', 'user'),
      createMessage('assistant-3', 'assistant', 'user-3')
    ]

    const firstPage = paginateMessages(messages, 0, 2)
    const secondPage = paginateMessages(messages, firstPage.nextCursor, 2)
    const thirdPage = paginateMessages(messages, secondPage.nextCursor, 2)

    expect(firstPage).toEqual({
      messages: [messages[5], messages[4]],
      nextCursor: 2,
      hasMore: true
    })
    expect(secondPage).toEqual({
      messages: [messages[3], messages[2]],
      nextCursor: 4,
      hasMore: true
    })
    expect(thirdPage).toEqual({
      messages: [messages[1], messages[0]],
      nextCursor: 6,
      hasMore: false
    })
  })

  it('uses the actual page length when grouped replies exceed the group limit', () => {
    const messages = [
      createMessage('user-1', 'user'),
      createMessage('assistant-1', 'assistant', 'user-1'),
      createMessage('assistant-2', 'assistant', 'user-1'),
      createMessage('assistant-3', 'assistant', 'user-1')
    ]

    expect(paginateMessages(messages, 0, 2)).toEqual({
      messages: [messages[3], messages[2], messages[1], messages[0]],
      nextCursor: 4,
      hasMore: false
    })
  })

  it('does not report another page when one reply group consumes all raw messages', () => {
    const messages = Array.from({ length: 6 }, (_, index) =>
      createMessage(`assistant-${index}`, 'assistant', 'shared-ask-id')
    )

    const page = paginateMessages(messages, 0, 5)

    expect(page.messages).toEqual(messages.toReversed())
    expect(page.nextCursor).toBe(messages.length)
    expect(page.hasMore).toBe(false)
  })

  it('counts assistant messages without askId independently', () => {
    const messages = [
      createMessage('assistant-1', 'assistant'),
      createMessage('assistant-2', 'assistant'),
      createMessage('assistant-3', 'assistant')
    ]

    expect(paginateMessages(messages, 0, 2)).toEqual({
      messages: [messages[2], messages[1]],
      nextCursor: 2,
      hasMore: true
    })
  })

  it('clamps a stale cursor past the end of the message array', () => {
    const messages = [createMessage('user-1', 'user')]

    expect(paginateMessages(messages, 10, 5)).toEqual({
      messages: [],
      nextCursor: 1,
      hasMore: false
    })
  })
})
