import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { StreamListener } from '../../types'
import type { MainDispatchRequest } from '../dispatch'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  ensureTraceIdTx: vi.fn(),
  getAgent: vi.fn(),
  saveMessage: vi.fn(),
  saveMessagesTx: vi.fn(),
  hasSessionMessages: vi.fn(),
  canAutoNameAgentSession: vi.fn(),
  maybeRenameAgentSessionFromFirstUserMessage: vi.fn(),
  maybeRenameAgentSession: vi.fn(),
  applicationGet: vi.fn(),
  runtimeBeginTurn: vi.fn(),
  runtimeEnqueueUserMessage: vi.fn(),
  runtimeIsSessionBusy: vi.fn(),
  runtimeValidateSession: vi.fn()
}))

vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: { getById: mocks.getSession, ensureTraceIdTx: mocks.ensureTraceIdTx }
}))

vi.mock('@data/services/AgentService', () => ({
  agentService: { getAgent: mocks.getAgent }
}))

vi.mock('@data/services/AgentSessionMessageService', () => ({
  AgentSessionDeliveryRoutingError: class extends Error {
    constructor(
      readonly code: string,
      message: string
    ) {
      super(message)
    }
  },
  agentSessionMessageService: {
    saveMessage: mocks.saveMessage,
    saveMessagesTx: mocks.saveMessagesTx,
    hasSessionMessages: mocks.hasSessionMessages
  }
}))

vi.mock('@main/services/TopicNamingService', () => ({
  topicNamingService: {
    canAutoNameAgentSession: mocks.canAutoNameAgentSession,
    maybeRenameAgentSessionFromFirstUserMessage: mocks.maybeRenameAgentSessionFromFirstUserMessage,
    maybeRenameAgentSession: mocks.maybeRenameAgentSession
  }
}))

vi.mock('@application', () => ({
  application: { get: mocks.applicationGet }
}))

const { AgentChatContextProvider } = await import('../AgentChatContextProvider')
const { runtimeDriverRegistry } = await import('../../../runtime/registry')

function makeSubscriber(id = 'wc:1:agent-session:session-1'): StreamListener {
  return {
    id,
    onChunk: vi.fn(),
    onDone: vi.fn(),
    onPaused: vi.fn(),
    onError: vi.fn(),
    isAlive: () => true
  }
}

function openReq(overrides: Partial<MainDispatchRequest> = {}): MainDispatchRequest {
  return {
    topicId: 'agent-session:session-1',
    trigger: 'submit-message',
    userMessageParts: [{ type: 'text', text: 'hello' }],
    ...overrides
  } as MainDispatchRequest
}

describe('AgentChatContextProvider', () => {
  let provider: InstanceType<typeof AgentChatContextProvider>

  beforeEach(() => {
    provider = new AgentChatContextProvider()

    vi.clearAllMocks()
    runtimeDriverRegistry.clearForTest()
    runtimeDriverRegistry.register({
      type: 'claude-code',
      capabilities: ['agent-session'],
      connect: vi.fn(),
      validateSession: mocks.runtimeValidateSession,
      listAvailableTools: vi.fn().mockResolvedValue([])
    })
    mocks.getSession.mockReturnValue({ id: 'session-1', agentId: 'agent-1', workspace: { path: '/tmp' } })
    mocks.ensureTraceIdTx.mockReturnValue('a'.repeat(32))
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      name: 'My Agent',
      type: 'claude-code',
      model: 'anthropic::claude-sonnet',
      modelName: 'Claude Sonnet'
    })
    mocks.saveMessage.mockImplementation(({ sessionId, message }) => ({
      id: message.id,
      sessionId,
      role: message.role,
      data: message.data,
      searchableText: '',
      status: message.status ?? 'success',
      modelId: message.modelId ?? null,
      messageSnapshot: message.messageSnapshot ?? null,
      stats: message.stats ?? null,
      runtimeResumeToken: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }))
    mocks.saveMessagesTx.mockImplementation((_tx, { sessionId, messages }) =>
      messages.map((message) => ({
        id: message.id,
        sessionId,
        role: message.role,
        data: message.data,
        searchableText: '',
        status: message.status ?? 'success',
        modelId: message.modelId ?? null,
        messageSnapshot: message.messageSnapshot ?? null,
        stats: message.stats ?? null,
        runtimeResumeToken: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }))
    )
    mocks.hasSessionMessages.mockReturnValue(false)
    mocks.canAutoNameAgentSession.mockReturnValue(true)
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'AgentSessionRuntimeService') {
        return {
          beginTurn: mocks.runtimeBeginTurn,
          enqueueUserMessage: mocks.runtimeEnqueueUserMessage,
          isSessionBusy: mocks.runtimeIsSessionBusy
        }
      }
      if (name === 'DbService') return { withWriteTx: (fn: (tx: object) => unknown) => fn({}) }
      throw new Error(`Unexpected application.get(${name})`)
    })
    mocks.runtimeBeginTurn.mockReturnValue({
      listeners: [makeSubscriber('runtime:persistence'), makeSubscriber('runtime:terminal')],
      turnId: 'turn-1'
    })
    mocks.runtimeValidateSession.mockResolvedValue(undefined)
    mocks.runtimeIsSessionBusy.mockReturnValue(false)
  })

  it('prepares fresh agent-session dispatch through the long-lived runtime service', async () => {
    const subscriber = makeSubscriber()
    mocks.runtimeIsSessionBusy.mockReturnValue(false)

    const prepared = await provider.prepareDispatch(subscriber, openReq())

    expect(mocks.runtimeValidateSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'session-1', workspace: { path: '/tmp' } })
    )
    expect(mocks.saveMessagesTx).toHaveBeenCalledOnce()
    expect(mocks.saveMessage).not.toHaveBeenCalled()
    expect(provider.isPersistentConversation).toBe(true)
    const savedMessages = mocks.saveMessagesTx.mock.calls[0][1].messages
    expect(savedMessages[1]).toMatchObject({
      role: 'assistant',
      modelId: 'anthropic::claude-sonnet'
    })
    expect(prepared.models).toHaveLength(1)
    expect(prepared.models[0].modelId).toBe('anthropic::claude-sonnet')
    expect(prepared.models[0].request.runtime).toEqual({
      kind: 'agent-session',
      sessionId: 'session-1',
      turnId: 'turn-1'
    })
    expect(prepared.models[0].request.messages).toEqual([
      { id: expect.any(String), role: 'user', parts: [{ type: 'text', text: 'hello' }] },
      { id: expect.any(String), role: 'assistant', parts: [] }
    ])
    expect(prepared.models[0].request.messageId).toBe(prepared.models[0].request.messages?.[1]?.id)
    expect(prepared.reservedMessages).toEqual([
      expect.objectContaining({ id: prepared.models[0].request.messages?.[0]?.id, role: 'user' }),
      expect.objectContaining({
        id: prepared.models[0].request.messageId,
        role: 'assistant',
        metadata: expect.objectContaining({
          status: 'pending',
          modelId: 'anthropic::claude-sonnet',
          messageSnapshot: {
            id: 'agent-1',
            name: 'My Agent',
            emoji: '🤖',
            model: { id: 'claude-sonnet', name: 'Claude Sonnet', provider: 'anthropic' }
          }
        })
      })
    ])
    expect(mocks.runtimeBeginTurn).toHaveBeenCalledWith({
      sessionId: 'session-1',
      topicId: 'agent-session:session-1',
      agentId: 'agent-1',
      agentType: 'claude-code',
      modelId: 'anthropic::claude-sonnet',
      reasoningEffort: 'default',
      serviceTier: 'standard',
      assistantMessageId: prepared.models[0].request.messageId,
      userMessage: expect.objectContaining({
        id: prepared.reservedMessages?.find((message) => message.role === 'user')?.id,
        role: 'user',
        sessionId: 'session-1'
      }),
      headless: false,
      traceId: 'a'.repeat(32),
      messageSnapshot: {
        id: 'agent-1',
        name: 'My Agent',
        emoji: '🤖',
        model: { id: 'claude-sonnet', name: 'Claude Sonnet', provider: 'anthropic' }
      },
      shouldAutoName: true
    })
    expect(prepared.listeners).toEqual([
      subscriber,
      expect.objectContaining({ id: 'runtime:persistence' }),
      expect.objectContaining({ id: 'runtime:terminal' })
    ])
  })

  it('preserves typed workspace validation errors for the dispatch boundary', async () => {
    const workspaceError = Object.assign(new Error('workspace is unavailable'), {
      name: 'AgentSessionWorkspaceError',
      retryable: true
    })
    mocks.runtimeValidateSession.mockRejectedValue(workspaceError)

    await expect(provider.validateDispatch(openReq())).rejects.toBe(workspaceError)
  })

  it('prepares live inject without creating a new runtime turn or assistant placeholder', async () => {
    const subscriber = makeSubscriber()
    mocks.runtimeIsSessionBusy.mockReturnValue(true)

    const prepared = await provider.prepareDispatch(subscriber, openReq())

    expect(mocks.saveMessage).toHaveBeenCalledOnce()
    expect(mocks.saveMessagesTx).not.toHaveBeenCalled()
    expect(mocks.runtimeBeginTurn).not.toHaveBeenCalled()
    expect(mocks.runtimeEnqueueUserMessage).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ role: 'user', sessionId: 'session-1' }),
      {
        headless: false,
        messageSnapshot: {
          id: 'agent-1',
          name: 'My Agent',
          emoji: '🤖',
          model: { id: 'claude-sonnet', name: 'Claude Sonnet', provider: 'anthropic' }
        },
        reasoningEffort: 'default',
        serviceTier: 'standard'
      }
    )
    expect(prepared.models).toEqual([])
    const userMessageId = prepared.reservedMessages?.find((message) => message.role === 'user')?.id
    expect(userMessageId).toEqual(expect.any(String))
    expect(prepared.reservedMessages).toEqual([
      expect.objectContaining({
        id: userMessageId,
        role: 'user',
        parts: [{ type: 'text', text: 'hello' }]
      })
    ])
    expect(prepared.listeners).toEqual([subscriber])
  })

  it('rejects a late busy transition when the caller requires an idle session', async () => {
    mocks.runtimeIsSessionBusy.mockReturnValue(true)

    await expect(
      provider.prepareDispatch(makeSubscriber(), openReq(), {
        hasLiveStream: false,
        requireIdle: true,
        expectedAgentId: 'agent-1'
      })
    ).rejects.toMatchObject({ code: 'RESOURCE_LOCKED' })

    expect(mocks.saveMessage).not.toHaveBeenCalled()
    expect(mocks.saveMessagesTx).not.toHaveBeenCalled()
    expect(mocks.runtimeEnqueueUserMessage).not.toHaveBeenCalled()
  })

  it('forwards headless to the runtime when busy dispatch enqueues a follow-up', async () => {
    const subscriber = makeSubscriber()
    mocks.runtimeIsSessionBusy.mockReturnValue(true)

    await provider.prepareDispatch(subscriber, openReq({ headless: true }))

    expect(mocks.runtimeEnqueueUserMessage).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ role: 'user', sessionId: 'session-1' }),
      {
        headless: true,
        messageSnapshot: {
          id: 'agent-1',
          name: 'My Agent',
          emoji: '🤖',
          model: { id: 'claude-sonnet', name: 'Claude Sonnet', provider: 'anthropic' }
        },
        reasoningEffort: 'default',
        serviceTier: 'standard'
      }
    )
  })

  it.each([
    ['an explicit empty recipient set', [] as const, []],
    ['an explicit recipient set', [{ id: 'ch1', type: 'telegram' }] as const, [{ id: 'ch1', type: 'telegram' }]],
    ['an omitted recipient set', undefined, undefined]
  ])('forwards %s to the runtime for both a fresh turn and a busy follow-up', async (_label, requested, expected) => {
    await provider.prepareAgentSessionDispatch(makeSubscriber(), openReq(), { trustedNotifyChannels: requested })
    expect(mocks.runtimeBeginTurn).toHaveBeenCalledWith(expect.objectContaining({ trustedNotifyChannels: expected }))

    mocks.runtimeIsSessionBusy.mockReturnValue(true)
    await provider.prepareAgentSessionDispatch(makeSubscriber(), openReq(), { trustedNotifyChannels: requested })
    expect(mocks.runtimeEnqueueUserMessage).toHaveBeenCalledWith(
      'session-1',
      expect.anything(),
      expect.objectContaining({ trustedNotifyChannels: expected })
    )
  })

  it('uses persisted Agent turn controls when the request does not override them', async () => {
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      name: 'My Agent',
      type: 'claude-code',
      model: 'anthropic::claude-sonnet',
      modelName: 'Claude Sonnet',
      configuration: { reasoning_effort: 'high', service_tier: 'flex' }
    })

    const prepared = await provider.prepareDispatch(makeSubscriber(), openReq())

    expect(mocks.runtimeBeginTurn).toHaveBeenCalledWith(
      expect.objectContaining({ reasoningEffort: 'high', serviceTier: 'flex' })
    )
    expect(prepared.models[0].request.reasoningEffort).toBe('high')
    expect(prepared.models[0].request.serviceTier).toBe('flex')
  })

  it('prefers explicit request turn controls over persisted Agent defaults', async () => {
    mocks.runtimeIsSessionBusy.mockReturnValue(true)
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      name: 'My Agent',
      type: 'claude-code',
      model: 'anthropic::claude-sonnet',
      modelName: 'Claude Sonnet',
      configuration: { reasoning_effort: 'high', service_tier: 'flex' }
    })

    await provider.prepareDispatch(makeSubscriber(), openReq({ reasoningEffort: 'low', serviceTier: 'fast' }))

    expect(mocks.runtimeEnqueueUserMessage).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ role: 'user' }),
      expect.objectContaining({ reasoningEffort: 'low', serviceTier: 'fast' })
    )
  })

  it('triggers first-user-message session rename after submit-message persists the user row', async () => {
    const subscriber = makeSubscriber()
    mocks.runtimeIsSessionBusy.mockReturnValue(false)

    await provider.prepareDispatch(subscriber, openReq({ userMessageParts: [{ type: 'text', text: 'hello session' }] }))

    expect(mocks.maybeRenameAgentSessionFromFirstUserMessage).toHaveBeenCalledWith('session-1', {
      parts: [{ type: 'text', text: 'hello session' }]
    })
    expect(mocks.hasSessionMessages).toHaveBeenCalledWith('session-1')
  })

  it('ignores a new Session delivery row when deciding whether to auto-name its first turn', async () => {
    const deliveryMessage = {
      id: 'delivery-1',
      sessionId: 'session-1',
      role: 'user',
      data: { parts: [{ type: 'text', text: 'delegated work' }] },
      delivery: { status: 'accepted' }
    }

    await provider.prepareDispatch(makeSubscriber(), openReq({ agentDeliveryMessage: deliveryMessage as never }))

    expect(mocks.hasSessionMessages).toHaveBeenCalledWith('session-1', 'delivery-1')
    expect(mocks.maybeRenameAgentSessionFromFirstUserMessage).toHaveBeenCalledWith('session-1', deliveryMessage.data)
  })

  it('does not auto-name a busy follow-up turn', async () => {
    const subscriber = makeSubscriber()
    mocks.runtimeIsSessionBusy.mockReturnValue(true)

    await provider.prepareDispatch(subscriber, openReq({ userMessageParts: [{ type: 'text', text: 'busy hello' }] }))

    expect(mocks.maybeRenameAgentSessionFromFirstUserMessage).not.toHaveBeenCalled()
    expect(mocks.hasSessionMessages).toHaveBeenCalledWith('session-1')
  })

  it('retries auto-naming on a later idle turn while the temporary title remains', async () => {
    mocks.hasSessionMessages.mockReturnValue(true)

    await provider.prepareDispatch(makeSubscriber(), openReq())

    expect(mocks.maybeRenameAgentSessionFromFirstUserMessage).not.toHaveBeenCalled()
    expect(mocks.canAutoNameAgentSession).toHaveBeenCalledWith('session-1')
    expect(mocks.runtimeBeginTurn).toHaveBeenCalledWith(expect.objectContaining({ shouldAutoName: true }))
  })

  it('does not auto-name a later idle turn once the session has a stable title', async () => {
    mocks.hasSessionMessages.mockReturnValue(true)
    mocks.canAutoNameAgentSession.mockReturnValue(false)

    await provider.prepareDispatch(makeSubscriber(), openReq())

    expect(mocks.maybeRenameAgentSessionFromFirstUserMessage).not.toHaveBeenCalled()
    expect(mocks.runtimeBeginTurn).toHaveBeenCalledWith(expect.objectContaining({ shouldAutoName: false }))
  })

  it('rejects agent sessions without a registered runtime driver', async () => {
    runtimeDriverRegistry.clearForTest()
    mocks.getAgent.mockReturnValue({ id: 'agent-1', type: 'custom-runtime', model: 'anthropic::claude-sonnet' })

    await expect(provider.prepareDispatch(makeSubscriber(), openReq())).rejects.toThrow(
      'Unsupported agent runtime type: custom-runtime'
    )
    expect(mocks.saveMessage).not.toHaveBeenCalled()
    expect(mocks.saveMessagesTx).not.toHaveBeenCalled()
  })
})
