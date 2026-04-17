import type { AiStreamOpenRequest } from '@shared/ai/transport'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AiStreamManager } from '../../AiStreamManager'

// ── Service mocks ────────────────────────────────────────────────────

const getTopicMock = vi.fn()
const hasTopicMock = vi.fn()
const appendMessageMock = vi.fn()
const listMessagesMock = vi.fn()

vi.mock('@main/data/services/TemporaryChatService', () => ({
  temporaryChatService: {
    getTopic: getTopicMock,
    hasTopic: hasTopicMock,
    appendMessage: appendMessageMock,
    listMessages: listMessagesMock
  }
}))

const getAssistantByIdMock = vi.fn()
vi.mock('@data/services/AssistantService', () => ({
  assistantDataService: { getById: getAssistantByIdMock }
}))

const getByKeyMock = vi.fn()
vi.mock('@main/data/services/ModelService', () => ({
  modelService: { getByKey: getByKeyMock }
}))

const { TemporaryChatContextProvider } = await import('../TemporaryChatContextProvider')
const { TemporaryPersistenceListener } = await import('../../listeners/TemporaryPersistenceListener')

// ── Helpers ──────────────────────────────────────────────────────────

function makeManager() {
  return {
    startExecution: vi.fn().mockReturnValue({ topicId: 'temp:1' })
  } as unknown as AiStreamManager & {
    startExecution: ReturnType<typeof vi.fn>
  }
}

function makeSubscriber() {
  return {
    id: 'wc:1:temp:1',
    onChunk: vi.fn(),
    onDone: vi.fn(),
    onPaused: vi.fn(),
    onError: vi.fn(),
    isAlive: () => true
  }
}

function openReq(overrides: Partial<AiStreamOpenRequest> = {}): AiStreamOpenRequest {
  return {
    topicId: 'temp:1',
    userMessageParts: [{ type: 'text', text: 'hi' }],
    ...overrides
  }
}

describe('TemporaryChatContextProvider', () => {
  let provider: InstanceType<typeof TemporaryChatContextProvider>

  beforeEach(() => {
    provider = new TemporaryChatContextProvider()
    getTopicMock.mockReset()
    hasTopicMock.mockReset()
    appendMessageMock.mockReset()
    listMessagesMock.mockReset()
    getAssistantByIdMock.mockReset()
    getByKeyMock.mockReset()

    // sensible defaults
    hasTopicMock.mockReturnValue(true)
    getTopicMock.mockReturnValue({ id: 'temp:1', assistantId: 'asst_1' })
    getAssistantByIdMock.mockResolvedValue({ id: 'asst_1', modelId: 'openai::gpt-4o' })
    getByKeyMock.mockResolvedValue({
      id: 'openai::gpt-4o',
      providerId: 'openai',
      apiModelId: 'gpt-4o',
      name: 'GPT-4o'
    })
    appendMessageMock.mockImplementation(async (_topicId, input) => ({
      id: 'service-generated-id',
      ...input
    }))
    listMessagesMock.mockResolvedValue([
      {
        id: 'msg-u',
        role: 'user',
        data: { parts: [{ type: 'text', text: 'hi' }] }
      }
    ])
  })

  it('canHandle is state-based (hasTopic), not prefix-based', () => {
    hasTopicMock.mockReturnValueOnce(true)
    expect(provider.canHandle('temp:1')).toBe(true)
    hasTopicMock.mockReturnValueOnce(false)
    expect(provider.canHandle('some-uuid')).toBe(false)
    // Even a temp-prefixed id returns false once service no longer holds it.
    hasTopicMock.mockReturnValueOnce(false)
    expect(provider.canHandle('temp:vanished')).toBe(false)
  })

  it('rejects regenerate-message — temp chats are immutable append-only', async () => {
    await expect(
      provider.handle(makeManager(), makeSubscriber(), openReq({ trigger: 'regenerate-message' }))
    ).rejects.toThrow(/regenerate-message is not supported/i)
  })

  it('throws when topic does not exist', async () => {
    getTopicMock.mockReturnValueOnce(null)
    await expect(provider.handle(makeManager(), makeSubscriber(), openReq())).rejects.toThrow(
      /Temporary topic not found/i
    )
  })

  it('throws when topic has no assistantId', async () => {
    getTopicMock.mockReturnValueOnce({ id: 'temp:1', assistantId: null })
    await expect(provider.handle(makeManager(), makeSubscriber(), openReq())).rejects.toThrow(
      /no assistantId configured/i
    )
  })

  it('appends the user message, then starts a single execution with a TemporaryPersistenceListener', async () => {
    const manager = makeManager()
    const subscriber = makeSubscriber()

    const resp = await provider.handle(manager, subscriber, openReq())

    expect(resp).toEqual({ mode: 'started' })

    // user message was appended (service allocates the id)
    expect(appendMessageMock).toHaveBeenCalledTimes(1)
    const [topicId, userInput] = appendMessageMock.mock.calls[0]
    expect(topicId).toBe('temp:1')
    expect(userInput.role).toBe('user')
    expect(userInput.id).toBeUndefined()

    expect(manager.startExecution).toHaveBeenCalledTimes(1)
    const args = manager.startExecution.mock.calls[0][0]
    expect(args.topicId).toBe('temp:1')
    expect(args.modelId).toBe('openai::gpt-4o')
    expect(args.isMultiModel).toBe(false)

    const listeners = args.listeners as unknown[]
    expect(listeners).toHaveLength(2)
    expect(listeners[0]).toBe(subscriber)
    expect(listeners[1]).toBeInstanceOf(TemporaryPersistenceListener)

    // history was built from listMessages (post-append) → 1 user message visible to AI SDK
    expect(args.request.messages).toHaveLength(1)
    expect(args.request.messages[0].role).toBe('user')
    // No pre-allocated messageId: AI SDK generates it for the streaming UIMessage
    expect(args.request.messageId).toBeUndefined()
  })

  it('ignores mentionedModelIds — temp chats are single-model only', async () => {
    const manager = makeManager()
    await provider.handle(
      manager,
      makeSubscriber(),
      openReq({ mentionedModelIds: ['openai::gpt-4o', 'anthropic::claude-sonnet'] })
    )

    // Only the assistant default model was resolved, single execution dispatched
    expect(getByKeyMock).toHaveBeenCalledTimes(1)
    expect(manager.startExecution).toHaveBeenCalledTimes(1)
  })
})
