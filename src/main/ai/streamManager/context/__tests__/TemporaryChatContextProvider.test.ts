import { ConversationKind, ConversationOpenTrigger } from '@shared/ai/conversation'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MainDispatchRequest } from '../dispatch'

// ── Service mocks ────────────────────────────────────────────────────

const getTopicMock = vi.fn()
const hasTopicMock = vi.fn()
const commitTurnSkeletonMock = vi.fn()
const listMessagesMock = vi.fn()

vi.mock('@main/data/services/TemporaryChatService', () => ({
  temporaryChatService: {
    getTopic: getTopicMock,
    hasTopic: hasTopicMock,
    commitTurnSkeleton: commitTurnSkeletonMock,
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

function openReq(overrides: Partial<MainDispatchRequest> = {}): MainDispatchRequest {
  return {
    conversation: { kind: ConversationKind.Chat, id: '1' },
    trigger: ConversationOpenTrigger.SubmitMessage,
    userMessageParts: [{ type: 'text', text: 'hi' }],
    ...overrides
  } as MainDispatchRequest
}

async function prepare(
  provider: InstanceType<typeof TemporaryChatContextProvider>,
  subscriber = makeSubscriber(),
  req = openReq(),
  hasLiveStream = false
) {
  const context = { hasLiveStream }
  const validated = await provider.validateDispatch(req, context, new AbortController().signal)
  const committed = provider.commitDispatch(subscriber, validated, context)
  return committed.prepareExecutionContext(new AbortController().signal)
}

describe('TemporaryChatContextProvider', () => {
  let provider: InstanceType<typeof TemporaryChatContextProvider>

  beforeEach(() => {
    provider = new TemporaryChatContextProvider()
    getTopicMock.mockReset()
    hasTopicMock.mockReset()
    commitTurnSkeletonMock.mockReset()
    listMessagesMock.mockReset()
    getAssistantByIdMock.mockReset()
    getByKeyMock.mockReset()
    MockMainPreferenceServiceUtils.resetMocks()
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.default_model_id', 'openai::gpt-4o')

    // sensible defaults
    hasTopicMock.mockReturnValue(true)
    getTopicMock.mockReturnValue({ id: '1', assistantId: 'asst_1' })
    getAssistantByIdMock.mockReturnValue({ id: 'asst_1', modelId: 'openai::gpt-4o' })
    getByKeyMock.mockReturnValue({
      id: 'openai::gpt-4o',
      providerId: 'openai',
      apiModelId: 'gpt-4o',
      name: 'GPT-4o'
    })
    commitTurnSkeletonMock.mockImplementation((_topicId, input) => ({
      user: { id: 'service-generated-id', createdAt: '2026-01-01', ...input.user },
      assistant: { id: input.assistant.id, createdAt: '2026-01-01', status: 'pending', ...input.assistant }
    }))
    listMessagesMock.mockReturnValue([])
  })

  it('canHandle is state-based (hasTopic), not prefix-based', () => {
    hasTopicMock.mockReturnValueOnce(true)
    expect(provider.canHandle({ kind: ConversationKind.Chat, id: '1' })).toBe(true)
    hasTopicMock.mockReturnValueOnce(false)
    expect(provider.canHandle({ kind: ConversationKind.Chat, id: 'some-uuid' })).toBe(false)
    // Even a temp-prefixed id returns false once service no longer holds it.
    hasTopicMock.mockReturnValueOnce(false)
    expect(provider.canHandle({ kind: ConversationKind.Chat, id: 'vanished' })).toBe(false)
  })

  it('rejects regenerate-message — temp chats are immutable append-only', async () => {
    await expect(
      prepare(provider, makeSubscriber(), openReq({ trigger: ConversationOpenTrigger.RegenerateMessage }))
    ).rejects.toThrow(/regenerate-message is not supported/i)
  })

  it('rejects a submit while a turn is in flight — temp chats have no steer queue', async () => {
    await expect(prepare(provider, makeSubscriber(), openReq(), true)).rejects.toThrow(/while a turn is in flight/i)
  })

  it('throws when topic does not exist', async () => {
    getTopicMock.mockReturnValueOnce(null)
    await expect(prepare(provider)).rejects.toThrow(/Temporary topic not found/i)
  })

  it('uses the default model preference when topic has no assistantId', async () => {
    getTopicMock.mockReturnValueOnce({ id: '1', assistantId: null })

    const prepared = await prepare(provider)

    expect(getAssistantByIdMock).not.toHaveBeenCalled()
    expect(prepared.models[0].modelId).toBe('openai::gpt-4o')
    expect(prepared.models[0].request.assistantId).toBeUndefined()
  })

  it('uses the default model preference when topic.assistantId is undefined', async () => {
    getTopicMock.mockReturnValueOnce({ id: '1', assistantId: undefined })

    const prepared = await prepare(provider)

    expect(getAssistantByIdMock).not.toHaveBeenCalled()
    expect(prepared.models[0].modelId).toBe('openai::gpt-4o')
    expect(prepared.models[0].request.assistantId).toBeUndefined()
  })

  it('honours a single mentionedModelId — pins that model instead of the default preference', async () => {
    getTopicMock.mockReturnValueOnce({ id: '1', assistantId: undefined })
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.default_model_id', null)
    getByKeyMock.mockReset()
    getByKeyMock.mockImplementation((providerId: string, modelId: string) => ({
      id: `${providerId}::${modelId}`,
      providerId,
      apiModelId: modelId,
      name: `${providerId}/${modelId}`
    }))

    const prepared = await prepare(
      provider,
      makeSubscriber(),
      openReq({ mentionedModelIds: ['anthropic::claude-sonnet-4-5'] })
    )

    expect(getByKeyMock).toHaveBeenCalledWith('anthropic', 'claude-sonnet-4-5')
    expect(prepared.models[0].modelId).toBe('anthropic::claude-sonnet-4-5')
  })

  it('warns and uses only the first when multiple mentionedModelIds are supplied (single-execution constraint)', async () => {
    getTopicMock.mockReturnValueOnce({ id: '1', assistantId: undefined })
    getByKeyMock.mockReset()
    getByKeyMock.mockImplementation((providerId: string, modelId: string) => ({
      id: `${providerId}::${modelId}`,
      providerId,
      apiModelId: modelId,
      name: `${providerId}/${modelId}`
    }))

    const prepared = await prepare(
      provider,
      makeSubscriber(),
      openReq({ mentionedModelIds: ['anthropic::claude-sonnet-4-5', 'openai::gpt-4o'] })
    )

    // Only the first one is materialised.
    expect(getByKeyMock).toHaveBeenCalledTimes(1)
    expect(getByKeyMock).toHaveBeenCalledWith('anthropic', 'claude-sonnet-4-5')
    expect(prepared.models[0].modelId).toBe('anthropic::claude-sonnet-4-5')
  })

  it('commits user and assistant skeleton atomically before preparing the execution context', async () => {
    const subscriber = makeSubscriber()
    const request = openReq()
    const dispatchContext = { hasLiveStream: false }
    const validated = await provider.validateDispatch(request, dispatchContext, new AbortController().signal)
    const committed = provider.commitDispatch(subscriber, validated, dispatchContext)
    const executionContext = await committed.prepareExecutionContext(new AbortController().signal)

    expect(executionContext.conversation).toEqual({ kind: ConversationKind.Chat, id: '1' })
    expect(provider.isPersistentConversation).toBe(false)

    expect(commitTurnSkeletonMock).toHaveBeenCalledTimes(1)
    const [topicId, skeleton] = commitTurnSkeletonMock.mock.calls[0]
    expect(topicId).toBe('1')
    expect(skeleton.user.role).toBe('user')
    expect(skeleton.assistant).toMatchObject({ role: 'assistant', data: { parts: [] } })

    expect(executionContext.models).toHaveLength(1)
    expect(executionContext.models[0].modelId).toBe('openai::gpt-4o')

    expect(committed.reservation.listeners).toEqual([subscriber])
    const persistencePorts = committed.reservation.persistencePorts
    expect(persistencePorts).toHaveLength(1)
    // Persistence is strategy-based: a PersistenceListener wrapping the
    // in-memory temp backend. We assert via the public `backendKind` getter
    // rather than reaching into private fields.
    const persist = persistencePorts?.[0]
    expect(persist).toBeInstanceOf(PersistenceListener)
    expect((persist as InstanceType<typeof PersistenceListener>).backendKind).toBe('temp')

    // The model context includes the committed user but not the pending assistant skeleton.
    const streamRequest = executionContext.models[0].request
    expect(streamRequest.messages).toBeDefined()
    expect(streamRequest.messages!).toHaveLength(1)
    expect(streamRequest.messages![0].role).toBe('user')
    // The stream and temporary backend share one stable message id so
    // invocation records can link to it before later promotion rebuilds the
    // same message projection.
    expect(streamRequest.messageId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('reads the knowledge scope from the submitted user-message parts', async () => {
    const prepared = await prepare(
      provider,
      makeSubscriber(),
      openReq({
        userMessageParts: [
          { type: 'text', text: 'search this' },
          { type: 'data-knowledge-scope', data: { baseIds: ['kb-1', 'kb-1', 'kb-2'] } }
        ]
      })
    )

    expect(prepared.models[0].request.knowledgeBaseIds).toEqual(['kb-1', 'kb-2'])
  })
})
