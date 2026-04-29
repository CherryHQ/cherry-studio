import type { CherryMessagePart } from '@shared/data/types/message'
import { describe, expect, it } from 'vitest'

import { createMessage } from '../create'
import {
  filterAdjacentUserMessaegs,
  filterAfterContextClearMessages,
  filterEmptyMessages,
  filterErrorOnlyMessagesWithRelated,
  filterUsefulMessages,
  filterUserRoleStartMessages
} from '../filters'

// ── Part-shape helpers ───────────────────────────────────────────────
// V2 filters read `Message.parts` directly — no Redux dispatch needed.

const textPart = (text: string): CherryMessagePart => ({ type: 'text', text }) as CherryMessagePart
const errorPart = (message: string): CherryMessagePart =>
  ({ type: 'data-error', data: { name: 'Error', message, stack: null } }) as CherryMessagePart
const filePart = (mediaType: string): CherryMessagePart =>
  ({ type: 'file', mediaType, url: 'file:///demo' }) as CherryMessagePart

describe('Message Filter Utils', () => {
  describe('filterAfterContextClearMessages', () => {
    it('should return all messages when no clear marker exists', () => {
      const msg1 = createMessage('user', 'topic-1', 'assistant-1', { id: 'msg-1' })
      const msg2 = createMessage('assistant', 'topic-1', 'assistant-1', { id: 'msg-2' })
      const messages = [msg1, msg2]

      const result = filterAfterContextClearMessages(messages)

      expect(result).toEqual(messages)
      expect(result).toHaveLength(2)
    })

    it('should return only messages after the last clear marker', () => {
      const msg1 = createMessage('user', 'topic-1', 'assistant-1', { id: 'msg-1' })
      const clearMsg = createMessage('user', 'topic-1', 'assistant-1', { id: 'clear-1', type: 'clear' })
      const msg2 = createMessage('user', 'topic-1', 'assistant-1', { id: 'msg-2' })
      const msg3 = createMessage('assistant', 'topic-1', 'assistant-1', { id: 'msg-3' })

      const result = filterAfterContextClearMessages([msg1, clearMsg, msg2, msg3])

      expect(result).toHaveLength(2)
      expect(result.map((m) => m.id)).toEqual(['msg-2', 'msg-3'])
    })
  })

  describe('filterUserRoleStartMessages', () => {
    it('should return messages starting from the first user message', () => {
      const assistant1 = createMessage('assistant', 'topic-1', 'assistant-1', { id: 'assistant-1' })
      const user1 = createMessage('user', 'topic-1', 'assistant-1', { id: 'user-1' })
      const assistant2 = createMessage('assistant', 'topic-1', 'assistant-1', { id: 'assistant-2' })

      const result = filterUserRoleStartMessages([assistant1, user1, assistant2])

      expect(result).toHaveLength(2)
      expect(result[0].id).toBe('user-1')
    })

    it('should return all messages when no user message is present', () => {
      const assistant1 = createMessage('assistant', 'topic-1', 'assistant-1', { id: 'assistant-1' })
      const assistant2 = createMessage('assistant', 'topic-1', 'assistant-1', { id: 'assistant-2' })

      const result = filterUserRoleStartMessages([assistant1, assistant2])

      expect(result).toHaveLength(2)
    })
  })

  describe('filterEmptyMessages', () => {
    it('should keep messages with main text content', () => {
      const msg = createMessage('user', 'topic-1', 'assistant-1', {
        id: 'msg-1',
        parts: [textPart('Hello')]
      })

      expect(filterEmptyMessages([msg])).toHaveLength(1)
    })

    it('should filter out messages with empty text content', () => {
      const msg = createMessage('user', 'topic-1', 'assistant-1', {
        id: 'msg-1',
        parts: [textPart('   ')]
      })

      expect(filterEmptyMessages([msg])).toHaveLength(0)
    })

    it('should keep messages with image parts', () => {
      const msg = createMessage('user', 'topic-1', 'assistant-1', {
        id: 'msg-1',
        parts: [filePart('image/png')]
      })

      expect(filterEmptyMessages([msg])).toHaveLength(1)
    })

    it('should keep messages with file parts', () => {
      const msg = createMessage('user', 'topic-1', 'assistant-1', {
        id: 'msg-1',
        parts: [filePart('application/pdf')]
      })

      expect(filterEmptyMessages([msg])).toHaveLength(1)
    })

    it('should filter out messages with no parts', () => {
      const msg = createMessage('user', 'topic-1', 'assistant-1', { id: 'msg-1', parts: [] })

      expect(filterEmptyMessages([msg])).toHaveLength(0)
    })
  })

  describe('filterUsefulMessages', () => {
    it('should keep the useful message when multiple assistant messages exist for same askId', () => {
      const userMsg = createMessage('user', 'topic-1', 'assistant-1', {
        id: 'user-1',
        parts: [textPart('Question')]
      })
      const assistant1 = createMessage('assistant', 'topic-1', 'assistant-1', {
        id: 'assistant-1',
        parts: [textPart('Answer 1')],
        askId: 'user-1',
        useful: false
      })
      const assistant2 = createMessage('assistant', 'topic-1', 'assistant-1', {
        id: 'assistant-2',
        parts: [textPart('Answer 2')],
        askId: 'user-1',
        useful: true
      })

      const result = filterUsefulMessages([userMsg, assistant1, assistant2])

      expect(result).toHaveLength(2)
      expect(result.find((m) => m.id === 'assistant-2')).toBeDefined()
      expect(result.find((m) => m.id === 'assistant-1')).toBeUndefined()
    })

    it('should keep the first message when no useful flag is set', () => {
      const userMsg = createMessage('user', 'topic-1', 'assistant-1', { id: 'user-1' })
      const assistant1 = createMessage('assistant', 'topic-1', 'assistant-1', {
        id: 'assistant-1',
        askId: 'user-1'
      })
      const assistant2 = createMessage('assistant', 'topic-1', 'assistant-1', {
        id: 'assistant-2',
        askId: 'user-1'
      })

      const result = filterUsefulMessages([userMsg, assistant1, assistant2])

      expect(result).toHaveLength(2)
      expect(result.find((m) => m.id === 'assistant-1')).toBeDefined()
      expect(result.find((m) => m.id === 'assistant-2')).toBeUndefined()
    })
  })

  describe('filterAdjacentUserMessaegs', () => {
    it('should keep only the last of adjacent user messages', () => {
      const user1 = createMessage('user', 'topic-1', 'assistant-1', { id: 'user-1' })
      const user2 = createMessage('user', 'topic-1', 'assistant-1', { id: 'user-2' })
      const user3 = createMessage('user', 'topic-1', 'assistant-1', { id: 'user-3' })

      const result = filterAdjacentUserMessaegs([user1, user2, user3])

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('user-3')
    })

    it('should keep non-adjacent user messages', () => {
      const user1 = createMessage('user', 'topic-1', 'assistant-1', { id: 'user-1' })
      const assistant1 = createMessage('assistant', 'topic-1', 'assistant-1', { id: 'assistant-1' })
      const user2 = createMessage('user', 'topic-1', 'assistant-1', { id: 'user-2' })

      expect(filterAdjacentUserMessaegs([user1, assistant1, user2])).toHaveLength(3)
    })

    it('should handle mixed scenario', () => {
      const user1 = createMessage('user', 'topic-1', 'assistant-1', { id: 'user-1' })
      const user2 = createMessage('user', 'topic-1', 'assistant-1', { id: 'user-2' })
      const assistant1 = createMessage('assistant', 'topic-1', 'assistant-1', { id: 'assistant-1' })
      const user3 = createMessage('user', 'topic-1', 'assistant-1', { id: 'user-3' })
      const user4 = createMessage('user', 'topic-1', 'assistant-1', { id: 'user-4' })

      const result = filterAdjacentUserMessaegs([user1, user2, assistant1, user3, user4])

      expect(result).toHaveLength(3)
      expect(result.map((m) => m.id)).toEqual(['user-2', 'assistant-1', 'user-4'])
    })
  })

  describe('filterErrorOnlyMessagesWithRelated', () => {
    it('should filter out assistant messages with only error parts and their associated user messages', () => {
      const user1 = createMessage('user', 'topic-1', 'assistant-1', {
        id: 'user-1',
        parts: [textPart('Question 1')]
      })
      const errorAssistant = createMessage('assistant', 'topic-1', 'assistant-1', {
        id: 'error-assistant',
        parts: [errorPart('Error occurred')],
        askId: 'user-1'
      })
      const user2 = createMessage('user', 'topic-1', 'assistant-1', {
        id: 'user-2',
        parts: [textPart('Question 2')]
      })

      const result = filterErrorOnlyMessagesWithRelated([user1, errorAssistant, user2])

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('user-2')
    })

    it('should NOT filter assistant messages with error AND other content parts', () => {
      const user = createMessage('user', 'topic-1', 'assistant-1', {
        id: 'user-1',
        parts: [textPart('Question')]
      })
      const assistant = createMessage('assistant', 'topic-1', 'assistant-1', {
        id: 'assistant-1',
        parts: [textPart('Partial answer'), errorPart('Error occurred')],
        askId: 'user-1'
      })

      const result = filterErrorOnlyMessagesWithRelated([user, assistant])

      expect(result).toHaveLength(2)
      expect(result.map((m) => m.id)).toEqual(['user-1', 'assistant-1'])
    })

    it('should handle multiple error-only pairs', () => {
      const user1 = createMessage('user', 'topic-1', 'assistant-1', {
        id: 'user-1',
        parts: [textPart('Q1')]
      })
      const error1 = createMessage('assistant', 'topic-1', 'assistant-1', {
        id: 'error-1',
        parts: [errorPart('Error 1')],
        askId: 'user-1'
      })
      const user2 = createMessage('user', 'topic-1', 'assistant-1', {
        id: 'user-2',
        parts: [textPart('Q2')]
      })
      const error2 = createMessage('assistant', 'topic-1', 'assistant-1', {
        id: 'error-2',
        parts: [errorPart('Error 2')],
        askId: 'user-2'
      })
      const user3 = createMessage('user', 'topic-1', 'assistant-1', {
        id: 'user-3',
        parts: [textPart('Q3')]
      })

      const result = filterErrorOnlyMessagesWithRelated([user1, error1, user2, error2, user3])

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('user-3')
    })

    it('should not filter assistant messages without askId', () => {
      const assistant = createMessage('assistant', 'topic-1', 'assistant-1', {
        id: 'assistant-1',
        parts: [errorPart('Error')]
      })

      expect(filterErrorOnlyMessagesWithRelated([assistant])).toHaveLength(1)
    })

    it('should keep assistant messages with empty parts (not error-only)', () => {
      const user = createMessage('user', 'topic-1', 'assistant-1', { id: 'user-1' })
      const assistant = createMessage('assistant', 'topic-1', 'assistant-1', {
        id: 'assistant-1',
        parts: [],
        askId: 'user-1'
      })

      expect(filterErrorOnlyMessagesWithRelated([user, assistant])).toHaveLength(2)
    })

    it('should work correctly in complex scenarios', () => {
      const user1 = createMessage('user', 'topic-1', 'assistant-1', {
        id: 'user-1',
        parts: [textPart('Q1')]
      })
      const assistant1 = createMessage('assistant', 'topic-1', 'assistant-1', {
        id: 'assistant-1',
        parts: [textPart('A1')],
        askId: 'user-1'
      })
      const user2 = createMessage('user', 'topic-1', 'assistant-1', {
        id: 'user-2',
        parts: [textPart('Q2')]
      })
      const errorAssistant = createMessage('assistant', 'topic-1', 'assistant-1', {
        id: 'error-assistant',
        parts: [errorPart('Error')],
        askId: 'user-2'
      })
      const user3 = createMessage('user', 'topic-1', 'assistant-1', {
        id: 'user-3',
        parts: [textPart('Q3')]
      })

      const result = filterErrorOnlyMessagesWithRelated([user1, assistant1, user2, errorAssistant, user3])

      expect(result).toHaveLength(3)
      expect(result.map((m) => m.id)).toEqual(['user-1', 'assistant-1', 'user-3'])
    })
  })
})
