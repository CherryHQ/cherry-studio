import { combineReducers, configureStore } from '@reduxjs/toolkit'
import { messageBlocksSlice } from '@renderer/store/messageBlock'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createErrorBlock, createMainTextBlock, createMessage } from '../create'
import {
  filterAdjacentUserMessaegs,
  filterAfterContextClearMessages,
  filterEmptyMessages,
  filterErrorOnlyMessagesWithRelated,
  filterLastAssistantMessage,
  filterUsefulMessages,
  filterUserRoleStartMessages
} from '../filters'

// Create a mock store
const reducer = combineReducers({
  messageBlocks: messageBlocksSlice.reducer
})

const createMockStore = () => {
  return configureStore({
    reducer: reducer,
    middleware: (getDefaultMiddleware) => getDefaultMiddleware({ serializableCheck: false })
  })
}

// Mock the store module
let mockStore: ReturnType<typeof createMockStore>

vi.mock('@renderer/store', () => ({
  default: {
    getState: () => mockStore.getState(),
    dispatch: (action: any) => mockStore.dispatch(action)
  }
}))

describe('Message Filter Utils', () => {
  beforeEach(() => {
    mockStore = createMockStore()
    vi.clearAllMocks()
  })

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
      expect(result[0].id).toBe('msg-2')
      expect(result[1].id).toBe('msg-3')
    })

    it('should handle multiple clear markers', () => {
      const msg1 = createMessage('user', 'topic-1', 'assistant-1', { id: 'msg-1' })
      const clear1 = createMessage('user', 'topic-1', 'assistant-1', { id: 'clear-1', type: 'clear' })
      const msg2 = createMessage('user', 'topic-1', 'assistant-1', { id: 'msg-2' })
      const clear2 = createMessage('user', 'topic-1', 'assistant-1', { id: 'clear-2', type: 'clear' })
      const msg3 = createMessage('user', 'topic-1', 'assistant-1', { id: 'msg-3' })

      const result = filterAfterContextClearMessages([msg1, clear1, msg2, clear2, msg3])

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('msg-3')
    })

    it('should return empty array when only clear marker exists', () => {
      const clearMsg = createMessage('user', 'topic-1', 'assistant-1', { id: 'clear-1', type: 'clear' })

      const result = filterAfterContextClearMessages([clearMsg])

      expect(result).toHaveLength(0)
    })
  })

  describe('filterUserRoleStartMessages', () => {
    it('should return all messages when first message is user', () => {
      const user1 = createMessage('user', 'topic-1', 'assistant-1', { id: 'user-1' })
      const assistant1 = createMessage('assistant', 'topic-1', 'assistant-1', { id: 'assistant-1' })

      const result = filterUserRoleStartMessages([user1, assistant1])

      expect(result).toHaveLength(2)
    })

    it('should remove leading assistant messages', () => {
      const assistant1 = createMessage('assistant', 'topic-1', 'assistant-1', { id: 'assistant-1' })
      const user1 = createMessage('user', 'topic-1', 'assistant-1', { id: 'user-1' })
      const assistant2 = createMessage('assistant', 'topic-1', 'assistant-1', { id: 'assistant-2' })

      const result = filterUserRoleStartMessages([assistant1, user1, assistant2])

      expect(result).toHaveLength(2)
      expect(result[0].id).toBe('user-1')
      expect(result[1].id).toBe('assistant-2')
    })

    it('should return original messages when no user message exists', () => {
      const assistant1 = createMessage('assistant', 'topic-1', 'assistant-1', { id: 'assistant-1' })
      const assistant2 = createMessage('assistant', 'topic-1', 'assistant-1', { id: 'assistant-2' })

      const result = filterUserRoleStartMessages([assistant1, assistant2])

      expect(result).toHaveLength(2)
    })
  })

  describe('filterEmptyMessages', () => {
    it('should keep messages with main text content', () => {
      const msgId = 'msg-1'
      const block = createMainTextBlock(msgId, 'Hello', { status: MessageBlockStatus.SUCCESS })
      const msg = createMessage('user', 'topic-1', 'assistant-1', { id: msgId, blocks: [block.id] })

      mockStore.dispatch(messageBlocksSlice.actions.upsertOneBlock(block))

      const result = filterEmptyMessages([msg])

      expect(result).toHaveLength(1)
    })

    it('should filter out messages with empty text content', () => {
      const msgId = 'msg-1'
      const block = createMainTextBlock(msgId, '   ', { status: MessageBlockStatus.SUCCESS })
      const msg = createMessage('user', 'topic-1', 'assistant-1', { id: msgId, blocks: [block.id] })

      mockStore.dispatch(messageBlocksSlice.actions.upsertOneBlock(block))

      const result = filterEmptyMessages([msg])

      expect(result).toHaveLength(0)
    })

    it('should keep messages with image blocks', () => {
      const msgId = 'msg-1'
      const msg = createMessage('user', 'topic-1', 'assistant-1', {
        id: msgId,
        blocks: ['image-block-1']
      })

      mockStore.dispatch(
        messageBlocksSlice.actions.upsertOneBlock({
          id: 'image-block-1',
          messageId: msgId,
          type: MessageBlockType.IMAGE,
          status: MessageBlockStatus.SUCCESS,
          createdAt: new Date().toISOString(),
          file: { id: 'file-1', origin_name: 'image.png' } as any
        })
      )

      const result = filterEmptyMessages([msg])

      expect(result).toHaveLength(1)
    })

    it('should keep messages with file blocks', () => {
      const msgId = 'msg-1'
      const msg = createMessage('user', 'topic-1', 'assistant-1', {
        id: msgId,
        blocks: ['file-block-1']
      })

      mockStore.dispatch(
        messageBlocksSlice.actions.upsertOneBlock({
          id: 'file-block-1',
          messageId: msgId,
          type: MessageBlockType.FILE,
          status: MessageBlockStatus.SUCCESS,
          createdAt: new Date().toISOString(),
          file: { id: 'file-1', origin_name: 'doc.pdf' } as any
        })
      )

      const result = filterEmptyMessages([msg])

      expect(result).toHaveLength(1)
    })

    it('should filter out messages with no blocks', () => {
      const msg = createMessage('user', 'topic-1', 'assistant-1', { id: 'msg-1', blocks: [] })

      const result = filterEmptyMessages([msg])

      expect(result).toHaveLength(0)
    })
  })

  describe('filterUsefulMessages', () => {
    it('should keep the useful message when multiple assistant messages exist for same askId', () => {
      const userId = 'user-1'
      const userBlock = createMainTextBlock(userId, 'Question', { status: MessageBlockStatus.SUCCESS })
      const userMsg = createMessage('user', 'topic-1', 'assistant-1', { id: userId, blocks: [userBlock.id] })

      const assistant1Id = 'assistant-1'
      const assistant1Block = createMainTextBlock(assistant1Id, 'Answer 1', { status: MessageBlockStatus.SUCCESS })
      const assistant1 = createMessage('assistant', 'topic-1', 'assistant-1', {
        id: assistant1Id,
        blocks: [assistant1Block.id],
        askId: userId,
        useful: false
      })

      const assistant2Id = 'assistant-2'
      const assistant2Block = createMainTextBlock(assistant2Id, 'Answer 2', { status: MessageBlockStatus.SUCCESS })
      const assistant2 = createMessage('assistant', 'topic-1', 'assistant-1', {
        id: assistant2Id,
        blocks: [assistant2Block.id],
        askId: userId,
        useful: true
      })

      mockStore.dispatch(messageBlocksSlice.actions.upsertOneBlock(userBlock))
      mockStore.dispatch(messageBlocksSlice.actions.upsertOneBlock(assistant1Block))
      mockStore.dispatch(messageBlocksSlice.actions.upsertOneBlock(assistant2Block))

      const result = filterUsefulMessages([userMsg, assistant1, assistant2])

      expect(result).toHaveLength(2)
      expect(result.find((m) => m.id === assistant2Id)).toBeDefined()
      expect(result.find((m) => m.id === assistant1Id)).toBeUndefined()
    })

    it('should keep the first message when no useful flag is set', () => {
      const userId = 'user-1'
      const userMsg = createMessage('user', 'topic-1', 'assistant-1', { id: userId })

      const assistant1 = createMessage('assistant', 'topic-1', 'assistant-1', {
        id: 'assistant-1',
        askId: userId
      })

      const assistant2 = createMessage('assistant', 'topic-1', 'assistant-1', {
        id: 'assistant-2',
        askId: userId
      })

      const result = filterUsefulMessages([userMsg, assistant1, assistant2])

      expect(result).toHaveLength(2)
      expect(result.find((m) => m.id === 'assistant-1')).toBeDefined()
      expect(result.find((m) => m.id === 'assistant-2')).toBeUndefined()
    })
  })

  describe('filterLastAssistantMessage', () => {
    it('should remove trailing assistant messages', () => {
      const user1 = createMessage('user', 'topic-1', 'assistant-1', { id: 'user-1' })
      const assistant1 = createMessage('assistant', 'topic-1', 'assistant-1', {
        id: 'assistant-1'
      })
      const assistant2 = createMessage('assistant', 'topic-1', 'assistant-1', {
        id: 'assistant-2'
      })

      const result = filterLastAssistantMessage([user1, assistant1, assistant2])

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('user-1')
    })

    it('should keep messages ending with user message', () => {
      const user1 = createMessage('user', 'topic-1', 'assistant-1', { id: 'user-1' })
      const assistant1 = createMessage('assistant', 'topic-1', 'assistant-1', {
        id: 'assistant-1'
      })
      const user2 = createMessage('user', 'topic-1', 'assistant-1', { id: 'user-2' })

      const result = filterLastAssistantMessage([user1, assistant1, user2])

      expect(result).toHaveLength(3)
    })

    it('should handle empty array', () => {
      const result = filterLastAssistantMessage([])

      expect(result).toHaveLength(0)
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
      const assistant1 = createMessage('assistant', 'topic-1', 'assistant-1', {
        id: 'assistant-1'
      })
      const user2 = createMessage('user', 'topic-1', 'assistant-1', { id: 'user-2' })

      const result = filterAdjacentUserMessaegs([user1, assistant1, user2])

      expect(result).toHaveLength(3)
    })

    it('should handle mixed scenario', () => {
      const user1 = createMessage('user', 'topic-1', 'assistant-1', { id: 'user-1' })
      const user2 = createMessage('user', 'topic-1', 'assistant-1', { id: 'user-2' })
      const assistant1 = createMessage('assistant', 'topic-1', 'assistant-1', {
        id: 'assistant-1'
      })
      const user3 = createMessage('user', 'topic-1', 'assistant-1', { id: 'user-3' })
      const user4 = createMessage('user', 'topic-1', 'assistant-1', { id: 'user-4' })

      const result = filterAdjacentUserMessaegs([user1, user2, assistant1, user3, user4])

      expect(result).toHaveLength(3)
      expect(result.map((m) => m.id)).toEqual(['user-2', 'assistant-1', 'user-4'])
    })
  })

  describe('filterErrorOnlyMessagesWithRelated', () => {
    it('should filter out assistant messages with only ErrorBlocks and their associated user messages', () => {
      const user1Id = 'user-1'
      const user1Block = createMainTextBlock(user1Id, 'Question 1', { status: MessageBlockStatus.SUCCESS })
      const user1 = createMessage('user', 'topic-1', 'assistant-1', { id: user1Id, blocks: [user1Block.id] })

      const errorAssistantId = 'assistant-error'
      const errorBlock = createErrorBlock(
        errorAssistantId,
        { message: 'Error occurred', name: 'Error', stack: null },
        { status: MessageBlockStatus.SUCCESS }
      )
      const errorAssistant = createMessage('assistant', 'topic-1', 'assistant-1', {
        id: errorAssistantId,
        blocks: [errorBlock.id],
        askId: user1Id
      })

      const user2Id = 'user-2'
      const user2Block = createMainTextBlock(user2Id, 'Question 2', { status: MessageBlockStatus.SUCCESS })
      const user2 = createMessage('user', 'topic-1', 'assistant-1', { id: user2Id, blocks: [user2Block.id] })

      mockStore.dispatch(messageBlocksSlice.actions.upsertOneBlock(user1Block))
      mockStore.dispatch(messageBlocksSlice.actions.upsertOneBlock(errorBlock))
      mockStore.dispatch(messageBlocksSlice.actions.upsertOneBlock(user2Block))

      const result = filterErrorOnlyMessagesWithRelated([user1, errorAssistant, user2])

      // Should only have user2, user1 and errorAssistant should be filtered out
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe(user2Id)
    })

    it('should NOT filter assistant messages with ErrorBlock AND other blocks', () => {
      const userId = 'user-1'
      const userBlock = createMainTextBlock(userId, 'Question', { status: MessageBlockStatus.SUCCESS })
      const user = createMessage('user', 'topic-1', 'assistant-1', { id: userId, blocks: [userBlock.id] })

      const assistantId = 'assistant-1'
      const textBlock = createMainTextBlock(assistantId, 'Partial answer', { status: MessageBlockStatus.SUCCESS })
      const errorBlock = createErrorBlock(
        assistantId,
        { message: 'Error occurred', name: 'Error', stack: null },
        { status: MessageBlockStatus.SUCCESS }
      )
      const assistant = createMessage('assistant', 'topic-1', 'assistant-1', {
        id: assistantId,
        blocks: [textBlock.id, errorBlock.id],
        askId: userId
      })

      mockStore.dispatch(messageBlocksSlice.actions.upsertOneBlock(userBlock))
      mockStore.dispatch(messageBlocksSlice.actions.upsertOneBlock(textBlock))
      mockStore.dispatch(messageBlocksSlice.actions.upsertOneBlock(errorBlock))

      const result = filterErrorOnlyMessagesWithRelated([user, assistant])

      // Should keep both messages as assistant has text content
      expect(result).toHaveLength(2)
      expect(result[0].id).toBe(userId)
      expect(result[1].id).toBe(assistantId)
    })

    it('should handle multiple error-only pairs', () => {
      const user1Id = 'user-1'
      const user1Block = createMainTextBlock(user1Id, 'Q1', { status: MessageBlockStatus.SUCCESS })
      const user1 = createMessage('user', 'topic-1', 'assistant-1', { id: user1Id, blocks: [user1Block.id] })

      const error1Id = 'error-1'
      const errorBlock1 = createErrorBlock(
        error1Id,
        { message: 'Error 1', name: 'Error', stack: null },
        { status: MessageBlockStatus.SUCCESS }
      )
      const error1 = createMessage('assistant', 'topic-1', 'assistant-1', {
        id: error1Id,
        blocks: [errorBlock1.id],
        askId: user1Id
      })

      const user2Id = 'user-2'
      const user2Block = createMainTextBlock(user2Id, 'Q2', { status: MessageBlockStatus.SUCCESS })
      const user2 = createMessage('user', 'topic-1', 'assistant-1', { id: user2Id, blocks: [user2Block.id] })

      const error2Id = 'error-2'
      const errorBlock2 = createErrorBlock(
        error2Id,
        { message: 'Error 2', name: 'Error', stack: null },
        { status: MessageBlockStatus.SUCCESS }
      )
      const error2 = createMessage('assistant', 'topic-1', 'assistant-1', {
        id: error2Id,
        blocks: [errorBlock2.id],
        askId: user2Id
      })

      const user3Id = 'user-3'
      const user3Block = createMainTextBlock(user3Id, 'Q3', { status: MessageBlockStatus.SUCCESS })
      const user3 = createMessage('user', 'topic-1', 'assistant-1', { id: user3Id, blocks: [user3Block.id] })

      mockStore.dispatch(messageBlocksSlice.actions.upsertOneBlock(user1Block))
      mockStore.dispatch(messageBlocksSlice.actions.upsertOneBlock(errorBlock1))
      mockStore.dispatch(messageBlocksSlice.actions.upsertOneBlock(user2Block))
      mockStore.dispatch(messageBlocksSlice.actions.upsertOneBlock(errorBlock2))
      mockStore.dispatch(messageBlocksSlice.actions.upsertOneBlock(user3Block))

      const result = filterErrorOnlyMessagesWithRelated([user1, error1, user2, error2, user3])

      // Should only have user3
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe(user3Id)
    })

    it('should not filter assistant messages without askId', () => {
      const assistantId = 'assistant-1'
      const errorBlock = createErrorBlock(
        assistantId,
        { message: 'Error', name: 'Error', stack: null },
        { status: MessageBlockStatus.SUCCESS }
      )
      const assistant = createMessage('assistant', 'topic-1', 'assistant-1', {
        id: assistantId,
        blocks: [errorBlock.id]
        // No askId
      })

      mockStore.dispatch(messageBlocksSlice.actions.upsertOneBlock(errorBlock))

      const result = filterErrorOnlyMessagesWithRelated([assistant])

      // Should keep the message as it has no askId
      expect(result).toHaveLength(1)
    })

    it('should handle assistant messages with empty blocks array', () => {
      const userId = 'user-1'
      const user = createMessage('user', 'topic-1', 'assistant-1', { id: userId })

      const assistantId = 'assistant-1'
      const assistant = createMessage('assistant', 'topic-1', 'assistant-1', {
        id: assistantId,
        blocks: [],
        askId: userId
      })

      const result = filterErrorOnlyMessagesWithRelated([user, assistant])

      // Should keep both as assistant has no blocks (not error-only)
      expect(result).toHaveLength(2)
    })

    it('should work correctly in complex scenarios', () => {
      const user1Id = 'user-1'
      const user1Block = createMainTextBlock(user1Id, 'Q1', { status: MessageBlockStatus.SUCCESS })
      const user1 = createMessage('user', 'topic-1', 'assistant-1', { id: user1Id, blocks: [user1Block.id] })

      const assistant1Id = 'assistant-1'
      const assistant1Block = createMainTextBlock(assistant1Id, 'A1', { status: MessageBlockStatus.SUCCESS })
      const assistant1 = createMessage('assistant', 'topic-1', 'assistant-1', {
        id: assistant1Id,
        blocks: [assistant1Block.id],
        askId: user1Id
      })

      const user2Id = 'user-2'
      const user2Block = createMainTextBlock(user2Id, 'Q2', { status: MessageBlockStatus.SUCCESS })
      const user2 = createMessage('user', 'topic-1', 'assistant-1', { id: user2Id, blocks: [user2Block.id] })

      const errorAssistantId = 'error-assistant'
      const errorBlock = createErrorBlock(
        errorAssistantId,
        { message: 'Error', name: 'Error', stack: null },
        { status: MessageBlockStatus.SUCCESS }
      )
      const errorAssistant = createMessage('assistant', 'topic-1', 'assistant-1', {
        id: errorAssistantId,
        blocks: [errorBlock.id],
        askId: user2Id
      })

      const user3Id = 'user-3'
      const user3Block = createMainTextBlock(user3Id, 'Q3', { status: MessageBlockStatus.SUCCESS })
      const user3 = createMessage('user', 'topic-1', 'assistant-1', { id: user3Id, blocks: [user3Block.id] })

      mockStore.dispatch(messageBlocksSlice.actions.upsertOneBlock(user1Block))
      mockStore.dispatch(messageBlocksSlice.actions.upsertOneBlock(assistant1Block))
      mockStore.dispatch(messageBlocksSlice.actions.upsertOneBlock(user2Block))
      mockStore.dispatch(messageBlocksSlice.actions.upsertOneBlock(errorBlock))
      mockStore.dispatch(messageBlocksSlice.actions.upsertOneBlock(user3Block))

      const result = filterErrorOnlyMessagesWithRelated([user1, assistant1, user2, errorAssistant, user3])

      // Should have user1, assistant1, and user3 (user2 and errorAssistant filtered out)
      expect(result).toHaveLength(3)
      expect(result.map((m) => m.id)).toEqual([user1Id, assistant1Id, user3Id])
    })
  })
})
