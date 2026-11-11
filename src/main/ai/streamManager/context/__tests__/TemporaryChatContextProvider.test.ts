import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AiStreamOpenRequest } from '@shared/ai/transport'

import { prefixUserMessageTimestamps } from '../../../messages/messageRules'

// ── Service mocks ────────────────────────────────────────────────────

const getTopicMock = vi.fn()
const hasTopicMock = vi.fn()
const appendMessageMock = vi.fn()
const listMessagesMock = vi.fn()
const retainAvatarMock = vi.fn()

vi.mock('@main/data/services/TemporaryChatService', () => ({
  temporaryChatService: {
    retainAvatar: retainAvatarMock,
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
    retainAvatarMock.mockReset()
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
    appendMessageMock.mockImplementation((_topicId, input) => ({
      id: 'service-generated-id',
      ...input
    }))
    listMessagesMock.mockReturnValue([
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
      provider.prepareDispatch(makeSubscriber(), openReq({ trigger: 'regenerate-message' }), { hasLiveStream: false })
    ).rejects.toThrow(/regenerate-message is not supported/i)
  })

  it('rejects a submit while a turn is in flight — temp chats have no steer queue', async () => {
    await expect(provider.prepareDispatch(makeSubscriber(), openReq(), { hasLiveStream: true })).rejects.toThrow(
      /while a turn is in flight/i
    )
  })

  it('throws when topic does not exist', async () => {
    getTopicMock.mockReturnValueOnce(null)
    await expect(provider.prepareDispatch(makeSubscriber(), openReq(), { hasLiveStream: false })).rejects.toThrow(
      /Temporary topic not found/i
    )
  })

  it('uses the default model preference when topic has no assistantId', async () => {
    getTopicMock.mockReturnValueOnce({ id: '1', assistantId: null })

    const prepared = await provider.prepareDispatch(makeSubscriber(), openReq(), { hasLiveStream: false })

    expect(getAssistantByIdMock).not.toHaveBeenCalled()
    expect(prepared.models[0].modelId).toBe('openai::gpt-4o')
    expect(prepared.models[0].request.assistantId).toBeUndefined()
  })

  it('uses the default model preference when topic.assistantId is undefined', async () => {
    getTopicMock.mockReturnValueOnce({ id: '1', assistantId: undefined })

    const prepared = await provider.prepareDispatch(makeSubscriber(), openReq(), { hasLiveStream: false })

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

    const prepared = await provider.prepareDispatch(
      makeSubscriber(),
      openReq({ mentionedModelIds: ['anthropic::claude-sonnet-4-5'] }),
      { hasLiveStream: false }
    )

    expect(getByKeyMock).toHaveBeenCalledWith('anthropic', 'claude-sonnet-4-5')
    expect(prepared.models[0].modelId).toBe('anthropic::claude-sonnet-4-5')
  })

  it('appends the user message, then returns a PreparedDispatch with a TemporaryChatBackend listener', async () => {
    const subscriber = makeSubscriber()

    const prepared = await provider.prepareDispatch(subscriber, openReq(), { hasLiveStream: false })

    expect(prepared.topicId).toBe('1')
    expect(provider.isPersistentConversation).toBe(false)

    // user message was appended (service allocates the id)
    expect(appendMessageMock).toHaveBeenCalledTimes(1)
    const [topicId, userInput] = appendMessageMock.mock.calls[0]
    expect(topicId).toBe('1')
    expect(userInput.role).toBe('user')
    expect(userInput.id).toBeUndefined()

    expect(prepared.models).toHaveLength(1)
    expect(prepared.models[0].modelId).toBe('openai::gpt-4o')

    const listeners = prepared.listeners
    // Persistence is strategy-based: a PersistenceListener wrapping the
    // in-memory temp backend. We assert via the public `backendKind` getter
    // rather than reaching into private fields.
    const persist = listeners[1]
    expect((persist as InstanceType<typeof PersistenceListener>).backendKind).toBe('temp')

    // history was built from listMessages (post-append) → 1 user message visible to AI SDK
    const request = prepared.models[0].request
    expect(request.messages).toBeDefined()
    expect(request.messages!).toHaveLength(1)
    expect(request.messages![0].role).toBe('user')
  })

  it('preserves creation timestamps through the model-facing history projection, keeping the send-time prefix effective', async () => {
    const userCreatedAt = '2026-11-04T21:15:30.000Z'
    const assistantCreatedAt = '2026-11-04T21:16:02.000Z'
    const followUpCreatedAt = '2026-11-04T21:17:00.000Z'
    listMessagesMock.mockReturnValue([
      {
        id: 'msg-u',
        role: 'user',
        data: { parts: [{ type: 'text', text: 'earlier question' }] },
        createdAt: userCreatedAt
      },
      {
        id: 'msg-a',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'earlier answer' }] },
        createdAt: assistantCreatedAt
      },
      { id: 'msg-u2', role: 'user', data: { parts: [{ type: 'text', text: 'hi' }] }, createdAt: followUpCreatedAt }
    ])

    const prepared = await provider.prepareDispatch(makeSubscriber(), openReq(), { hasLiveStream: false })
    const history = prepared.models[0].request.messages!

    // Producer-generated history carries the stored creation timestamps on metadata...
    expect(history.map((m) => (m.metadata as { createdAt?: string } | undefined)?.createdAt)).toEqual([
      userCreatedAt,
      assistantCreatedAt,
      followUpCreatedAt
    ])

    // ...so the optional send-time prefix actually reaches the user turns served to the model.
    const prefixed = prefixUserMessageTimestamps(history)
    expect(prefixed[0].parts[0]).toMatchObject({
      type: 'text',
      text: expect.stringMatching(/^<message-time>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{2}:\d{2}<\/message-time>$/)
    })
    expect(prefixed[2].parts[0]).toMatchObject({ type: 'text', text: expect.stringMatching(/^<message-time>/) })
    // Assistant turns are never prefixed.
    expect(prefixed[1].parts).toEqual(history[1].parts)
  })

  it('reads the knowledge scope from the submitted user-message parts', async () => {
    const prepared = await provider.prepareDispatch(
      makeSubscriber(),
      openReq({
        userMessageParts: [
          { type: 'text', text: 'search this' },
          { type: 'data-knowledge-scope', data: { baseIds: ['kb-1', 'kb-1', 'kb-2'] } }
        ]
      }),
      { hasLiveStream: false }
    )

    expect(prepared.models[0].request.knowledgeBaseIds).toEqual(['kb-1', 'kb-2'])
  })

  it('retains a captured avatar before prepareDispatch first yields', async () => {
    const fileId = '019606a0-0000-7000-8000-00000000aa05'
    getAssistantByIdMock.mockReturnValue({
      id: 'asst_1',
      name: 'Author',
      emoji: '🌟',
      avatarFileId: fileId,
      modelId: 'openai::gpt-4o'
    })
    const preparing = provider.prepareDispatch(makeSubscriber(), openReq(), { hasLiveStream: false })
    expect(retainAvatarMock).toHaveBeenCalledWith('1', fileId)
    await preparing
  })
  it('does not retain an avatar if preparation fails before dispatch', async () => {
    getAssistantByIdMock.mockReturnValue({
      id: 'asst_1',
      avatarFileId: '019606a0-0000-7000-8000-00000000aa05',
      modelId: 'openai::gpt-4o'
    })
    listMessagesMock.mockImplementation(() => {
      throw new Error('history failed')
    })
    await expect(provider.prepareDispatch(makeSubscriber(), openReq(), { hasLiveStream: false })).rejects.toThrow(
      'history failed'
    )
    expect(retainAvatarMock).not.toHaveBeenCalled()
  })
})
