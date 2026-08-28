import { describe, expect, it } from 'vitest'

import type { MessageListItem } from '../../types'
import {
  getLatestAssistantGroupKey,
  getMessageGroupKey,
  getOwningUserMessageIdByAssistantId,
  groupMessageListItems
} from '../messageGroupKey'

const createMessage = (id: string, role: MessageListItem['role'], parentId?: string | null) =>
  ({
    id,
    role,
    parentId
  }) as MessageListItem

describe('messageGroupKey', () => {
  it('uses the parent id for assistant sibling groups', () => {
    expect(getMessageGroupKey(createMessage('assistant-1', 'assistant', 'user-1'))).toBe('assistantuser-1')
  })

  it('uses role and id for non-assistant messages', () => {
    expect(getMessageGroupKey(createMessage('user-1', 'user'))).toBe('useruser-1')
  })

  it('groups assistant siblings together and keeps user messages separate', () => {
    const grouped = groupMessageListItems([
      createMessage('user-1', 'user'),
      createMessage('assistant-1', 'assistant', 'user-1'),
      createMessage('assistant-2', 'assistant', 'user-1')
    ])

    expect(Object.keys(grouped)).toEqual(['useruser-1', 'assistantuser-1'])
    expect(grouped['assistantuser-1'].map((message) => message.id)).toEqual(['assistant-1', 'assistant-2'])
  })

  it('returns the latest assistant group key', () => {
    const messages = [
      createMessage('assistant-1', 'assistant', 'user-1'),
      createMessage('user-2', 'user'),
      createMessage('assistant-2', 'assistant', 'user-2')
    ]

    expect(getLatestAssistantGroupKey(messages)).toBe('assistantuser-2')
  })

  it.each([
    {
      assistant: createMessage('assistant-1', 'assistant', 'user-1'),
      expectedOwnerId: 'user-1',
      name: 'uses a valid explicit parent'
    },
    {
      assistant: createMessage('assistant-1', 'assistant'),
      expectedOwnerId: 'user-1',
      name: 'falls back to the preceding user without a parent'
    },
    {
      assistant: createMessage('assistant-1', 'assistant', 'missing-user'),
      expectedOwnerId: undefined,
      name: 'rejects an invalid explicit parent'
    }
  ])('$name when resolving an assistant owner', ({ assistant, expectedOwnerId }) => {
    const messages = [createMessage('user-1', 'user'), assistant]

    expect(getOwningUserMessageIdByAssistantId(messages).get(assistant.id)).toBe(expectedOwnerId)
  })
})
