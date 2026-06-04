import type { AiStreamOpenRequest } from '@shared/ai/transport'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
const { PersistenceListener } = await import('../../listeners/PersistenceListener')

// ── Helpers ──────────────────────────────────────────────────────────

function makeSubscriber() {
  return {
    id: 'wc:1:1',
    onChunk: vi.fn(),
    onDone: vi.fn(),
    onPaused: vi.fn(),
    onError: vi.fn(),
    isAlive: () => true
  }
}

function openReq(overrides: Partial<AiStreamOpenRequest> = {}): AiStreamOpenRequest {
  return {
    topicId: '1',
    trigger: 'submit-message',
    userMessageParts: [{ type: 'text', text: 'hi' }],
    ...overrides
  } as AiStreamOpenRequest
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
    MockMainPreferenceServiceUtils.resetMocks()
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.default_model_id', 'openai::gpt-4o')

    // sensible defaults
    hasTopicMock.mockReturnValue(true)
    getTopicMock.mockReturnValue({ id: '1', assistantId: 'asst_1' })
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
    expect(provider.canHandle('1')).toBe(true)
    hasTopicMock.mockReturnValueOnce(false)
    expect(provider.canHandle('some-uuid')).toBe(false)
    // Even a temp-prefixed id returns false once service no longer holds it.
    hasTopicMock.mockReturnValueOnce(false)
    expect(provider.canHandle('vanished')).toBe(false)
  })

  it('rejects regenerate-message — temp chats are immutable append-only', async () => {
    await expect(
      provider.prepareDispatch(makeSubscriber(), openReq({ trigger: 'regenerate-message' }))
    ).rejects.toThrow(/regenerate-message is not supported/i)
  })

  it('throws when topic does not exist', async () => {
    getTopicMock.mockReturnValueOnce(null)
    await expect(provider.prepareDispatch(makeSubscriber(), openReq())).rejects.toThrow(/Temporary topic not found/i)
  })

  it('uses the default model preference when topic has no assistantId', async () => {
    getTopicMock.mockReturnValueOnce({ id: '1', assistantId: null })

    const prepared = await provider.prepareDispatch(makeSubscriber(), openReq())

    expect(getAssistantByIdMock).not.toHaveBeenCalled()
    expect(prepared.models[0].modelId).toBe('openai::gpt-4o')
    expect(prepared.models[0].request.assistantId).toBeUndefined()
  })

  it('uses the default model preference when topic.assistantId is undefined', async () => {
    getTopicMock.mockReturnValueOnce({ id: '1', assistantId: undefined })

    const prepared = await provider.prepareDispatch(makeSubscriber(), openReq())

    expect(getAssistantByIdMock).not.toHaveBeenCalled()
    expect(prepared.models[0].modelId).toBe('openai::gpt-4o')
    expect(prepared.models[0].request.assistantId).toBeUndefined()
  })

  it('honours a single mentionedModelId — pins that model instead of the default preference', async () => {
    getTopicMock.mockReturnValueOnce({ id: '1', assistantId: undefined })
    getByKeyMock.mockReset()
    getByKeyMock.mockImplementation(async (providerId: string, modelId: string) => ({
      id: `${providerId}::${modelId}`,
      providerId,
      apiModelId: modelId,
      name: `${providerId}/${modelId}`
    }))

    const prepared = await provider.prepareDispatch(
      makeSubscriber(),
      openReq({ mentionedModelIds: ['anthropic::claude-sonnet-4-5'] })
    )

    expect(getByKeyMock).toHaveBeenCalledWith('anthropic', 'claude-sonnet-4-5')
    expect(prepared.models[0].modelId).toBe('anthropic::claude-sonnet-4-5')
  })

  it('warns and uses only the first when multiple mentionedModelIds are supplied (single-execution constraint)', async () => {
    getTopicMock.mockReturnValueOnce({ id: '1', assistantId: undefined })
    getByKeyMock.mockReset()
    getByKeyMock.mockImplementation(async (providerId: string, modelId: string) => ({
      id: `${providerId}::${modelId}`,
      providerId,
      apiModelId: modelId,
      name: `${providerId}/${modelId}`
    }))

    const prepared = await provider.prepareDispatch(
      makeSubscriber(),
      openReq({ mentionedModelIds: ['anthropic::claude-sonnet-4-5', 'openai::gpt-4o'] })
    )

    // Only the first one is materialised.
    expect(getByKeyMock).toHaveBeenCalledTimes(1)
    expect(getByKeyMock).toHaveBeenCalledWith('anthropic', 'claude-sonnet-4-5')
    expect(prepared.models[0].modelId).toBe('anthropic::claude-sonnet-4-5')
  })

  it('appends the user message, then returns a PreparedDispatch with a TemporaryChatBackend listener', async () => {
    const subscriber = makeSubscriber()

    const prepared = await provider.prepareDispatch(subscriber, openReq())

    expect(prepared.topicId).toBe('1')
    expect(prepared.isMultiModel).toBe(false)
    expect(prepared.userMessage).toBeUndefined()

    // user message was appended (service allocates the id)
    expect(appendMessageMock).toHaveBeenCalledTimes(1)
    const [topicId, userInput] = appendMessageMock.mock.calls[0]
    expect(topicId).toBe('1')
    expect(userInput.role).toBe('user')
    expect(userInput.id).toBeUndefined()

    expect(prepared.models).toHaveLength(1)
    expect(prepared.models[0].modelId).toBe('openai::gpt-4o')

    const listeners = prepared.listeners
    expect(listeners).toHaveLength(2)
    expect(listeners[0]).toBe(subscriber)
    // Persistence is strategy-based: a PersistenceListener wrapping the
    // in-memory temp backend. We assert via the public `backendKind` getter
    // rather than reaching into private fields.
    const persist = listeners[1]
    expect(persist).toBeInstanceOf(PersistenceListener)
    expect((persist as InstanceType<typeof PersistenceListener>).backendKind).toBe('temp')

    // history was built from listMessages (post-append) → 1 user message visible to AI SDK
    const request = prepared.models[0].request
    expect(request.messages).toBeDefined()
    expect(request.messages!).toHaveLength(1)
    expect(request.messages![0].role).toBe('user')
    // No pre-allocated messageId: AI SDK generates it for the streaming UIMessage
    expect(request.messageId).toBeUndefined()
  })
})
