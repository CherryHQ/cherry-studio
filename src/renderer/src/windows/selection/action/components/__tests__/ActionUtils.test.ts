import type { Assistant, Topic } from '@renderer/types'
import {
  AssistantMessageStatus,
  type ErrorMessageBlock,
  type MainTextMessageBlock,
  type Message,
  MessageBlockStatus,
  MessageBlockType,
  type ThinkingMessageBlock
} from '@renderer/types/newMessage'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

const sendMessagesMock = vi.hoisted(() => vi.fn())

vi.mock('@renderer/transport/IpcChatTransport', () => ({
  IpcChatTransport: vi.fn(() => ({
    sendMessages: sendMessagesMock
  }))
}))

vi.mock('@renderer/services/MessagesService', () => ({
  getUserMessage: vi.fn(),
  getAssistantMessage: vi.fn()
}))

vi.mock('@renderer/utils/abortController', () => ({
  addAbortController: vi.fn(),
  removeAbortController: vi.fn()
}))

vi.mock('@renderer/utils/error', () => ({
  isAbortError: vi.fn(),
  isTimeoutError: vi.fn(),
  formatErrorMessage: vi.fn()
}))

vi.mock('@renderer/utils/messageUtils/create', () => ({
  createMainTextBlock: vi.fn(),
  createThinkingBlock: vi.fn(),
  createErrorBlock: vi.fn()
}))

import { getAssistantMessage, getUserMessage } from '@renderer/services/MessagesService'
import { addAbortController } from '@renderer/utils/abortController'
import { formatErrorMessage, isAbortError } from '@renderer/utils/error'
import { createErrorBlock, createMainTextBlock, createThinkingBlock } from '@renderer/utils/messageUtils/create'

import { type ActionSessionSnapshot, processMessages } from '../ActionUtils'

function createStream(chunks: any[]) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk)
      }
      controller.close()
    }
  })
}

describe('processMessages', () => {
  let mockAssistant: Assistant
  let mockTopic: Topic
  let mockSetAskId: Mock
  let mockOnSessionUpdate: Mock
  let mockOnStream: Mock
  let mockOnFinish: Mock
  let mockOnError: Mock
  let registeredAbortFn: (() => void) | undefined

  beforeEach(() => {
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

    mockSetAskId = vi.fn()
    mockOnSessionUpdate = vi.fn()
    mockOnStream = vi.fn()
    mockOnFinish = vi.fn()
    mockOnError = vi.fn()

    vi.clearAllMocks()

    vi.mocked(getUserMessage).mockReturnValue({
      message: {
        id: 'user-message-1',
        role: 'user',
        assistantId: 'assistant-1',
        topicId: 'topic-1',
        createdAt: new Date().toISOString(),
        status: 'success',
        blocks: []
      },
      blocks: []
    } as any)

    vi.mocked(getAssistantMessage).mockReturnValue({
      id: 'assistant-message-1',
      role: 'assistant',
      assistantId: 'assistant-1',
      topicId: 'topic-1',
      createdAt: new Date().toISOString(),
      status: AssistantMessageStatus.PENDING,
      blocks: []
    } as Message)

    vi.mocked(createThinkingBlock).mockImplementation(
      (messageId: string, content = '', options?: { status?: MessageBlockStatus }) =>
        ({
          id: 'thinking-block-1',
          messageId,
          type: MessageBlockType.THINKING,
          createdAt: new Date().toISOString(),
          content,
          status: options?.status ?? MessageBlockStatus.PENDING,
          thinking_millsec: 0
        }) as ThinkingMessageBlock
    )

    vi.mocked(createMainTextBlock).mockImplementation(
      (messageId: string, content: string, options?: { status?: MessageBlockStatus }) =>
        ({
          id: 'text-block-1',
          messageId,
          type: MessageBlockType.MAIN_TEXT,
          createdAt: new Date().toISOString(),
          content,
          status: options?.status ?? MessageBlockStatus.PENDING
        }) as MainTextMessageBlock
    )

    vi.mocked(createErrorBlock).mockImplementation(
      (messageId: string, error: any, options?: { status?: MessageBlockStatus }) =>
        ({
          id: 'error-block-1',
          messageId,
          type: MessageBlockType.ERROR,
          createdAt: new Date().toISOString(),
          status: options?.status ?? MessageBlockStatus.ERROR,
          error
        }) as ErrorMessageBlock
    )

    vi.mocked(isAbortError).mockReturnValue(false)
    vi.mocked(formatErrorMessage).mockReturnValue('Formatted error message')
    vi.mocked(addAbortController).mockImplementation((_, abortFn) => {
      registeredAbortFn = abortFn
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
    registeredAbortFn = undefined
  })

  it('processes a complete reasoning + text stream into local session snapshots', async () => {
    sendMessagesMock.mockResolvedValue(
      createStream([
        { type: 'reasoning-start' },
        { type: 'reasoning-delta', delta: 'Think 1 ' },
        { type: 'reasoning-delta', delta: 'Think 2' },
        { type: 'reasoning-end' },
        { type: 'text-start' },
        { type: 'text-delta', delta: 'Hello ' },
        { type: 'text-delta', delta: 'world' },
        { type: 'text-end' },
        { type: 'finish' }
      ])
    )

    await processMessages(
      mockAssistant,
      mockTopic,
      'test prompt',
      mockSetAskId,
      mockOnSessionUpdate,
      mockOnStream,
      mockOnFinish,
      mockOnError
    )

    expect(mockSetAskId).toHaveBeenCalledWith('user-message-1')
    expect(sendMessagesMock).toHaveBeenCalled()
    expect(mockOnSessionUpdate).toHaveBeenCalled()
    expect(mockOnFinish).toHaveBeenCalledWith('Hello world')
    expect(mockOnError).not.toHaveBeenCalled()

    const snapshots = mockOnSessionUpdate.mock.calls.map(([snapshot]) => snapshot as ActionSessionSnapshot)
    const lastSnapshot = snapshots.at(-1)
    expect(lastSnapshot?.assistantMessage.status).toBe(AssistantMessageStatus.SUCCESS)
    expect(lastSnapshot?.partsMap['assistant-message-1']).toEqual([
      expect.objectContaining({
        type: 'reasoning',
        text: 'Think 1 Think 2',
        providerMetadata: {
          cherry: {
            thinkingMs: expect.any(Number)
          }
        }
      }),
      expect.objectContaining({
        type: 'text',
        text: 'Hello world'
      })
    ])
  })

  it('handles stream error chunk and appends a local error part', async () => {
    sendMessagesMock.mockResolvedValue(
      createStream([
        { type: 'text-start' },
        { type: 'text-delta', delta: 'Partial response' },
        { type: 'error', error: new Error('Stream processing error') }
      ])
    )

    await processMessages(
      mockAssistant,
      mockTopic,
      'test prompt',
      mockSetAskId,
      mockOnSessionUpdate,
      mockOnStream,
      mockOnFinish,
      mockOnError
    )

    expect(mockOnFinish).toHaveBeenCalledWith('Partial response')
    expect(mockOnError).not.toHaveBeenCalled()

    const snapshots = mockOnSessionUpdate.mock.calls.map(([snapshot]) => snapshot as ActionSessionSnapshot)
    const lastSnapshot = snapshots.at(-1)
    expect(lastSnapshot?.assistantMessage.status).toBe(AssistantMessageStatus.ERROR)
    expect(lastSnapshot?.partsMap['assistant-message-1']).toEqual([
      expect.objectContaining({
        type: 'text',
        text: 'Partial response'
      }),
      expect.objectContaining({
        type: 'data-error',
        data: expect.objectContaining({
          message: 'Stream processing error'
        })
      })
    ])
  })

  it('handles abort chunk and marks assistant as paused', async () => {
    vi.mocked(isAbortError).mockReturnValue(true)
    sendMessagesMock.mockResolvedValue(
      createStream([{ type: 'text-start' }, { type: 'text-delta', delta: 'Partial' }, { type: 'abort' }])
    )

    await processMessages(
      mockAssistant,
      mockTopic,
      'test prompt',
      mockSetAskId,
      mockOnSessionUpdate,
      mockOnStream,
      mockOnFinish,
      mockOnError
    )

    const snapshots = mockOnSessionUpdate.mock.calls.map(([snapshot]) => snapshot as ActionSessionSnapshot)
    const lastSnapshot = snapshots.at(-1)
    expect(lastSnapshot?.assistantMessage.status).toBe(AssistantMessageStatus.PAUSED)
    expect(lastSnapshot?.partsMap['assistant-message-1']).toEqual([
      expect.objectContaining({
        type: 'text',
        text: 'Partial'
      }),
      expect.objectContaining({
        type: 'data-error',
        data: expect.objectContaining({
          message: 'Request was aborted'
        })
      })
    ])
    expect(mockOnError).not.toHaveBeenCalled()
  })

  it('treats an abort-closed stream as paused even without an explicit abort chunk', async () => {
    vi.mocked(isAbortError).mockImplementation((error) => error instanceof DOMException && error.name === 'AbortError')
    sendMessagesMock.mockImplementation(async ({ abortSignal }: { abortSignal?: AbortSignal }) => {
      return new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'text-start' })
          controller.enqueue({ type: 'text-delta', delta: 'Partial' })
          abortSignal?.addEventListener(
            'abort',
            () => {
              controller.close()
            },
            { once: true }
          )
          queueMicrotask(() => {
            registeredAbortFn?.()
          })
        }
      })
    })

    await processMessages(
      mockAssistant,
      mockTopic,
      'test prompt',
      mockSetAskId,
      mockOnSessionUpdate,
      mockOnStream,
      mockOnFinish,
      mockOnError
    )

    const snapshots = mockOnSessionUpdate.mock.calls.map(([snapshot]) => snapshot as ActionSessionSnapshot)
    const lastSnapshot = snapshots.at(-1)
    expect(lastSnapshot?.assistantMessage.status).toBe(AssistantMessageStatus.PAUSED)
    expect(lastSnapshot?.partsMap['assistant-message-1']).toEqual([
      expect.objectContaining({
        type: 'text',
        text: 'Partial'
      }),
      expect.objectContaining({
        type: 'data-error',
        data: expect.objectContaining({
          message: 'Request was aborted'
        })
      })
    ])
  })

  it('handles sendMessages rejection', async () => {
    const mockError = new Error('Transport Error')
    sendMessagesMock.mockRejectedValue(mockError)

    await processMessages(
      mockAssistant,
      mockTopic,
      'test prompt',
      mockSetAskId,
      mockOnSessionUpdate,
      mockOnStream,
      mockOnFinish,
      mockOnError
    )

    expect(mockOnError).toHaveBeenCalledWith(mockError)
  })

  it('passes assistant runtime overrides to the transport body', async () => {
    sendMessagesMock.mockResolvedValue(createStream([{ type: 'finish' }]))

    await processMessages(
      {
        ...mockAssistant,
        prompt: 'runtime prompt',
        enableWebSearch: true,
        webSearchProviderId: 'tavily',
        settings: {
          streamOutput: false,
          reasoning_effort: 'high',
          toolUseMode: 'function',
          temperature: 0.1,
          topP: 1,
          contextCount: 3
        }
      } as Assistant,
      mockTopic,
      'test prompt',
      mockSetAskId,
      mockOnSessionUpdate,
      mockOnStream,
      mockOnFinish,
      mockOnError
    )

    expect(sendMessagesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          assistantOverrides: expect.objectContaining({
            prompt: 'runtime prompt',
            enableWebSearch: true,
            webSearchProviderId: undefined,
            settings: expect.objectContaining({
              streamOutput: true,
              reasoning_effort: 'high'
            })
          })
        })
      })
    )
  })

  it('returns early when assistant is missing', async () => {
    await processMessages(
      null as any,
      mockTopic,
      'test prompt',
      mockSetAskId,
      mockOnSessionUpdate,
      mockOnStream,
      mockOnFinish,
      mockOnError
    )

    expect(sendMessagesMock).not.toHaveBeenCalled()
    expect(mockSetAskId).not.toHaveBeenCalled()
    expect(mockOnError).not.toHaveBeenCalled()
  })
})
