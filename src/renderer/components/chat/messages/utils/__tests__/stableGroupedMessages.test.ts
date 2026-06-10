import { describe, expect, it } from 'vitest'

import type { MessageListItem } from '../../types'
import { createStableGroupedMessagesCache, stableGroupedMessages } from '../stableGroupedMessages'

const createMessage = (id: string, role: MessageListItem['role'], parentId?: string | null) =>
  ({
    id,
    parentId,
    role
  }) as MessageListItem

describe('stableGroupedMessages', () => {
  it('reuses the previous entries when message group contents are unchanged', () => {
    const cache = createStableGroupedMessagesCache()
    const userMessage = createMessage('user-1', 'user')
    const assistantMessage = createMessage('assistant-1', 'assistant', 'user-1')

    const first = stableGroupedMessages([userMessage, assistantMessage], cache)
    const second = stableGroupedMessages([userMessage, assistantMessage], cache)

    expect(second).toBe(first)
    expect(second[0]?.[1]).toBe(first[0]?.[1])
    expect(second[1]?.[1]).toBe(first[1]?.[1])
  })

  it('keeps unchanged group arrays while replacing changed groups', () => {
    const cache = createStableGroupedMessagesCache()
    const userMessage = createMessage('user-1', 'user')
    const assistantMessage = createMessage('assistant-1', 'assistant', 'user-1')
    const first = stableGroupedMessages([userMessage, assistantMessage], cache)
    const nextAssistantMessage = createMessage('assistant-2', 'assistant', 'user-1')

    const second = stableGroupedMessages([userMessage, assistantMessage, nextAssistantMessage], cache)

    expect(second).not.toBe(first)
    expect(second[0]?.[1]).toBe(first[0]?.[1])
    expect(second[1]?.[1]).not.toBe(first[1]?.[1])
    expect(second[1]?.[1].map((message) => message.id)).toEqual(['assistant-1', 'assistant-2'])
  })
})
