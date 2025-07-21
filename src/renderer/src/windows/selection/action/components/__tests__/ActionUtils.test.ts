import type { Assistant, Topic } from '@renderer/types'
import { ChunkType } from '@renderer/types/chunk'
import { AssistantMessageStatus, MessageBlockStatus } from '@renderer/types/newMessage'
import OpenAI from 'openai'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

import { processMessages } from '../ActionUtils'

// Mock all dependencies
vi.mock('@renderer/services/ApiService', () => ({
  fetchChatCompletion: vi.fn()
}))

vi.mock('@renderer/services/MessagesService', () => ({
  getUserMessage: vi.fn(),
  getAssistantMessage: vi.fn()
}))

vi.mock('@renderer/store', () => ({
  default: {
    dispatch: vi.fn()
  }
}))

vi.mock('@renderer/store/messageBlock', () => ({
  updateOneBlock: vi.fn(),
  upsertManyBlocks: vi.fn(),
  upsertOneBlock: vi.fn()
}))

vi.mock('@renderer/store/newMessage', () => ({
  newMessagesActions: {
    addMessage: vi.fn(),
    updateMessage: vi.fn()
  }
}))

vi.mock('@renderer/store/thunk/messageThunk', () => ({
  cancelThrottledBlockUpdate: vi.fn(),
  throttledBlockUpdate: vi.fn()
}))

vi.mock('@renderer/utils/error', () => ({
  isAbortError: vi.fn(),
  formatErrorMessage: vi.fn()
}))

vi.mock('@renderer/utils/messageUtils/create', () => ({
  createMainTextBlock: vi.fn(),
  createThinkingBlock: vi.fn(),
  createErrorBlock: vi.fn()
}))

// Import mocked modules
import { fetchChatCompletion } from '@renderer/services/ApiService'
import { getAssistantMessage, getUserMessage } from '@renderer/services/MessagesService'
import store from '@renderer/store'
import { updateOneBlock } from '@renderer/store/messageBlock'
import { newMessagesActions } from '@renderer/store/newMessage'
import { cancelThrottledBlockUpdate, throttledBlockUpdate } from '@renderer/store/thunk/messageThunk'
import { formatErrorMessage, isAbortError } from '@renderer/utils/error'
import { createErrorBlock, createMainTextBlock, createThinkingBlock } from '@renderer/utils/messageUtils/create'

describe('processMessages', () => {
  let mockAssistant: Assistant
  let mockTopic: Topic
  let mockSetAskId: Mock
  let mockOnStream: Mock
  let mockOnFinish: Mock
  let mockOnError: Mock

  beforeEach(() => {
    // Setup mock data
    mockAssistant = {
      id: 'assistant-1',
      name: 'Test Assistant',
      model: {
        id: 'model-1',
        name: 'test model',
        provider: 'test provider',
        group: 'test group'
      },
      prompt: '',
      topics: [],
      type: 'assistant'
    } as Assistant

    mockTopic = {
      id: 'topic-1',
      name: 'Test Topic'
    } as Topic

    // Setup mock callbacks
    mockSetAskId = vi.fn()
    mockOnStream = vi.fn()
    mockOnFinish = vi.fn()
    mockOnError = vi.fn()

    // Reset all mocks
    vi.clearAllMocks()

    // Setup default mock implementations
    vi.mocked(getUserMessage).mockReturnValue({
      message: { id: 'user-message-1', role: 'user', content: 'test prompt' },
      blocks: []
    } as any)

    vi.mocked(getAssistantMessage).mockReturnValue({
      id: 'assistant-message-1',
      role: 'assistant',
      content: ''
    } as any)

    vi.mocked(createThinkingBlock).mockReturnValue({
      id: 'thinking-block-1',
      content: '',
      status: MessageBlockStatus.STREAMING
    } as any)

    vi.mocked(createMainTextBlock).mockReturnValue({
      id: 'text-block-1',
      content: '',
      status: MessageBlockStatus.STREAMING
    } as any)

    vi.mocked(createErrorBlock).mockReturnValue({
      id: 'error-block-1',
      content: '',
      status: MessageBlockStatus.ERROR
    } as any)

    vi.mocked(isAbortError).mockReturnValue(false)
    vi.mocked(formatErrorMessage).mockReturnValue('Formatted error message')
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('normal complete stream with thinking flow', () => {
    it('should process a complete stream with thinking and text blocks', async () => {
      // Mock chunk stream for normal flow
      const mockChunks = [
        { type: ChunkType.THINKING_START },
        { type: ChunkType.THINKING_DELTA, text: 'I need to think about this...', thinking_millsec: 1000 },
        {
          type: ChunkType.THINKING_DELTA,
          text: 'I need to think about this... Let me consider the options.',
          thinking_millsec: 2000
        },
        {
          type: ChunkType.THINKING_COMPLETE,
          text: 'I need to think about this... Let me consider the options. Now I have a solution.',
          thinking_millsec: 3000
        },
        { type: ChunkType.TEXT_START },
        { type: ChunkType.TEXT_DELTA, text: 'Here is' },
        { type: ChunkType.TEXT_DELTA, text: 'Here is my' },
        { type: ChunkType.TEXT_DELTA, text: 'Here is my answer' },
        { type: ChunkType.TEXT_COMPLETE, text: 'Here is my answer to your question.' },
        { type: ChunkType.BLOCK_COMPLETE }
      ]

      vi.mocked(fetchChatCompletion).mockImplementation(async ({ onChunkReceived }: any) => {
        for (const chunk of mockChunks) {
          await onChunkReceived(chunk)
        }
        const rawOutput: OpenAI.ChatCompletion = {
          id: 'test-id',
          model: 'test-model',
          object: 'chat.completion',
          created: Date.now(),
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Here is my answer to your question.',
                refusal: ''
              },
              finish_reason: 'stop',
              logprobs: null
            }
          ]
        }
        return {
          rawOutput,
          getText: () => 'Here is my answer to your question.'
        }
      })

      await processMessages(
        mockAssistant,
        mockTopic,
        'test prompt',
        mockSetAskId,
        mockOnStream,
        mockOnFinish,
        mockOnError
      )

      // Verify setAskId was called
      expect(mockSetAskId).toHaveBeenCalledWith('user-message-1')

      // Verify store dispatches for user message
      expect(store.dispatch).toHaveBeenCalledWith(
        newMessagesActions.addMessage({
          topicId: 'topic-1',
          message: expect.objectContaining({ id: 'user-message-1' })
        })
      )

      // Verify store dispatches for assistant message
      expect(store.dispatch).toHaveBeenCalledWith(
        newMessagesActions.addMessage({
          topicId: 'topic-1',
          message: expect.objectContaining({ id: 'assistant-message-1' })
        })
      )

      // Verify thinking block creation and updates
      expect(createThinkingBlock).toHaveBeenCalledWith('assistant-message-1', '', {
        status: MessageBlockStatus.STREAMING
      })
      expect(throttledBlockUpdate).toHaveBeenCalledWith('thinking-block-1', {
        content: 'I need to think about this...',
        thinking_millsec: 1000
      })
      expect(throttledBlockUpdate).toHaveBeenCalledWith('thinking-block-1', {
        content: 'I need to think about this... Let me consider the options.',
        thinking_millsec: 2000
      })

      // Verify thinking block completion
      expect(cancelThrottledBlockUpdate).toHaveBeenCalledWith('thinking-block-1')
      expect(store.dispatch).toHaveBeenCalledWith(
        updateOneBlock({
          id: 'thinking-block-1',
          changes: {
            content: 'I need to think about this... Let me consider the options. Now I have a solution.',
            status: MessageBlockStatus.SUCCESS,
            thinking_millsec: 3000
          }
        })
      )

      // Verify text block creation and updates
      expect(createMainTextBlock).toHaveBeenCalledWith('assistant-message-1', '', {
        status: MessageBlockStatus.STREAMING
      })
      expect(throttledBlockUpdate).toHaveBeenCalledWith('text-block-1', { content: 'Here is' })
      expect(throttledBlockUpdate).toHaveBeenCalledWith('text-block-1', { content: 'Here is my' })
      expect(throttledBlockUpdate).toHaveBeenCalledWith('text-block-1', { content: 'Here is my answer' })

      // Verify text block completion
      expect(cancelThrottledBlockUpdate).toHaveBeenCalledWith('text-block-1')
      expect(store.dispatch).toHaveBeenCalledWith(
        updateOneBlock({
          id: 'text-block-1',
          changes: {
            content: 'Here is my answer to your question.',
            status: MessageBlockStatus.SUCCESS
          }
        })
      )

      // Verify callbacks
      expect(mockOnStream).toHaveBeenCalledWith()

      // Verify final message status update
      expect(store.dispatch).toHaveBeenCalledWith(
        newMessagesActions.updateMessage({
          topicId: 'topic-1',
          messageId: 'assistant-message-1',
          updates: { status: AssistantMessageStatus.SUCCESS }
        })
      )

      expect(mockOnFinish).toHaveBeenCalledWith('Here is my answer to your question.')
      // Verify no errors
      expect(mockOnError).not.toHaveBeenCalled()
    })
  })

  describe('stream with exceptions', () => {
    it('should handle error chunks properly', async () => {
      const mockError = new Error('Stream processing error')
      const mockChunks = [
        { type: ChunkType.TEXT_START },
        { type: ChunkType.TEXT_DELTA, text: 'Partial response' },
        { type: ChunkType.ERROR, error: mockError }
      ]

      vi.mocked(fetchChatCompletion).mockImplementation(async ({ onChunkReceived }: any) => {
        for (const chunk of mockChunks) {
          await onChunkReceived(chunk)
        }
        const rawOutput: OpenAI.ChatCompletion = {
          id: 'test-id',
          model: 'test-model',
          object: 'chat.completion',
          created: Date.now(),
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Partial response',
                refusal: ''
              },
              finish_reason: 'stop',
              logprobs: null
            }
          ]
        }
        return {
          rawOutput,
          getText: () => 'Partial response'
        }
      })

      await processMessages(
        mockAssistant,
        mockTopic,
        'test prompt',
        mockSetAskId,
        mockOnStream,
        mockOnFinish,
        mockOnError
      )

      // Verify text block was created and updated
      expect(createMainTextBlock).toHaveBeenCalled()
      expect(throttledBlockUpdate).toHaveBeenCalledWith('text-block-1', { content: 'Partial response' })
      expect(mockOnStream).toHaveBeenCalledWith()

      // Verify error handling
      expect(store.dispatch).toHaveBeenCalledWith(
        updateOneBlock({
          id: 'text-block-1',
          changes: {
            status: MessageBlockStatus.ERROR
          }
        })
      )

      // Verify error block creation
      expect(createErrorBlock).toHaveBeenCalledWith(
        'assistant-message-1',
        expect.objectContaining({
          name: 'Error',
          message: 'Stream processing error'
        }),
        { status: MessageBlockStatus.ERROR }
      )

      expect(store.dispatch).toHaveBeenCalledWith(
        newMessagesActions.updateMessage({
          topicId: 'topic-1',
          messageId: 'assistant-message-1',
          updates: {
            status: AssistantMessageStatus.ERROR
          }
        })
      )

      // Verify onFinish is called with text content accumulated so far
      expect(mockOnFinish).toHaveBeenCalledWith('Partial response')
      expect(mockOnError).not.toHaveBeenCalled()
    })

    it('should handle fetchChatCompletion errors', async () => {
      const mockError = new Error('API Error')
      vi.mocked(fetchChatCompletion).mockRejectedValue(mockError)

      await processMessages(
        mockAssistant,
        mockTopic,
        'test prompt',
        mockSetAskId,
        mockOnStream,
        mockOnFinish,
        mockOnError
      )

      // Verify error callback is called
      expect(mockOnError).toHaveBeenCalledWith(mockError)
    })
  })

  describe('actively aborted stream', () => {
    it('should handle aborted streams properly', async () => {
      const mockAbortError = new Error('AbortError')
      vi.mocked(isAbortError).mockReturnValue(true)

      const mockChunks = [
        { type: ChunkType.THINKING_START },
        { type: ChunkType.THINKING_DELTA, text: 'Starting to think...', thinking_millsec: 1000 },
        { type: ChunkType.TEXT_START },
        { type: ChunkType.TEXT_DELTA, text: 'Partial' },
        { type: ChunkType.ERROR, error: mockAbortError }
      ]

      vi.mocked(fetchChatCompletion).mockImplementation(async ({ onChunkReceived }: any) => {
        for (const chunk of mockChunks) {
          await onChunkReceived(chunk)
        }
        const rawOutput: OpenAI.ChatCompletion = {
          id: 'test-id',
          model: 'test-model',
          object: 'chat.completion',
          created: Date.now(),
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Partial',
                refusal: ''
              },
              finish_reason: 'stop',
              logprobs: null
            }
          ]
        }
        return {
          rawOutput,
          getText: () => 'Partial'
        }
      })

      await processMessages(
        mockAssistant,
        mockTopic,
        'test prompt',
        mockSetAskId,
        mockOnStream,
        mockOnFinish,
        mockOnError
      )

      // Verify both blocks were created
      expect(createThinkingBlock).toHaveBeenCalled()
      expect(createMainTextBlock).toHaveBeenCalled()

      // Verify partial updates were made
      expect(throttledBlockUpdate).toHaveBeenCalledWith('thinking-block-1', {
        content: 'Starting to think...',
        thinking_millsec: 1000
      })
      expect(throttledBlockUpdate).toHaveBeenCalledWith('text-block-1', { content: 'Partial' })

      // Verify abort handling - should set status to PAUSED
      expect(store.dispatch).toHaveBeenCalledWith(
        updateOneBlock({
          id: 'text-block-1',
          changes: {
            status: MessageBlockStatus.PAUSED
          }
        })
      )

      expect(store.dispatch).toHaveBeenCalledWith(
        newMessagesActions.updateMessage({
          topicId: 'topic-1',
          messageId: 'assistant-message-1',
          updates: {
            status: AssistantMessageStatus.PAUSED
          }
        })
      )

      // Verify error block creation for abort
      expect(createErrorBlock).toHaveBeenCalledWith(
        'assistant-message-1',
        expect.objectContaining({
          name: 'Error',
          message: 'pause_placeholder'
        }),
        { status: MessageBlockStatus.PAUSED }
      )

      // Verify callbacks
      expect(mockOnStream).toHaveBeenCalledWith()
      expect(mockOnFinish).toHaveBeenCalledWith('Partial')
      expect(mockOnError).not.toHaveBeenCalled()
    })

    it('should handle aborted fetchChatCompletion gracefully', async () => {
      const mockAbortError = new Error('AbortError')
      vi.mocked(isAbortError).mockReturnValue(true)
      vi.mocked(fetchChatCompletion).mockRejectedValue(mockAbortError)

      await processMessages(
        mockAssistant,
        mockTopic,
        'test prompt',
        mockSetAskId,
        mockOnStream,
        mockOnFinish,
        mockOnError
      )

      // Verify that abort errors are handled gracefully (no error callback)
      expect(mockOnError).not.toHaveBeenCalled()
      expect(mockOnFinish).not.toHaveBeenCalled()
    })
  })

  describe('edge cases', () => {
    it('should handle missing assistant or topic', async () => {
      await processMessages(
        null as any,
        mockTopic,
        'test prompt',
        mockSetAskId,
        mockOnStream,
        mockOnFinish,
        mockOnError
      )

      // Should return early without making any calls
      expect(fetchChatCompletion).not.toHaveBeenCalled()
      expect(mockSetAskId).not.toHaveBeenCalled()
      expect(mockOnStream).not.toHaveBeenCalled()
      expect(mockOnFinish).not.toHaveBeenCalled()
      expect(mockOnError).not.toHaveBeenCalled()
    })

    it('should handle multiple text/thinking blocks correctly', async () => {
      const mockChunks = [
        { type: ChunkType.THINKING_START },
        { type: ChunkType.THINKING_COMPLETE, text: 'First thinking', thinking_millsec: 1000 },
        { type: ChunkType.TEXT_START },
        { type: ChunkType.TEXT_COMPLETE, text: 'First text' },
        { type: ChunkType.THINKING_START },
        { type: ChunkType.THINKING_COMPLETE, text: 'Second thinking', thinking_millsec: 2000 },
        { type: ChunkType.TEXT_START },
        { type: ChunkType.TEXT_COMPLETE, text: 'Second text' }
      ]

      vi.mocked(createThinkingBlock)
        .mockReturnValueOnce({
          id: 'thinking-block-1',
          content: '',
          status: MessageBlockStatus.STREAMING
        } as any)
        .mockReturnValueOnce({
          id: 'thinking-block-2',
          content: '',
          status: MessageBlockStatus.STREAMING
        } as any)

      vi.mocked(createMainTextBlock)
        .mockReturnValueOnce({
          id: 'text-block-1',
          content: '',
          status: MessageBlockStatus.STREAMING
        } as any)
        .mockReturnValueOnce({
          id: 'text-block-2',
          content: '',
          status: MessageBlockStatus.STREAMING
        } as any)

      vi.mocked(fetchChatCompletion).mockImplementation(async ({ onChunkReceived }: any) => {
        for (const chunk of mockChunks) {
          await onChunkReceived(chunk)
        }
        const rawOutput: OpenAI.ChatCompletion = {
          id: 'test-id',
          model: 'test-model',
          object: 'chat.completion',
          created: Date.now(),
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Second text',
                refusal: ''
              },
              finish_reason: 'stop',
              logprobs: null
            }
          ]
        }
        return {
          rawOutput,
          getText: () => 'Second text'
        }
      })

      await processMessages(
        mockAssistant,
        mockTopic,
        'test prompt',
        mockSetAskId,
        mockOnStream,
        mockOnFinish,
        mockOnError
      )

      // Verify both thinking blocks were created and completed
      expect(createThinkingBlock).toHaveBeenCalledTimes(2)
      expect(createMainTextBlock).toHaveBeenCalledTimes(2)

      // Verify onFinish was called for both text completions
      expect(mockOnFinish).toHaveBeenCalledWith('First text')
      expect(mockOnFinish).toHaveBeenCalledWith('Second text')
    })
  })
})
