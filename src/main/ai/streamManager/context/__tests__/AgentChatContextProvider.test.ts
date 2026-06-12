import type { AiStreamOpenRequest } from '@shared/ai/transport'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { StreamListener } from '../../types'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getAgent: vi.fn(),
  saveMessage: vi.fn(),
  saveMessages: vi.fn(),
  maybeRenameAgentSession: vi.fn(),
  applicationGet: vi.fn(),
  traceStorageSetTopicId: vi.fn(),
  runtimeBeginTurn: vi.fn(),
  runtimeEnqueueUserMessage: vi.fn(),
  runtimeIsSessionBusy: vi.fn()
}))

vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: { getById: mocks.getSession }
}))

vi.mock('@data/services/AgentService', () => ({
  agentService: { getAgent: mocks.getAgent }
}))

vi.mock('@data/services/AgentSessionMessageService', () => ({
  agentSessionMessageService: {
    saveMessage: mocks.saveMessage,
    saveMessages: mocks.saveMessages
  }
}))

vi.mock('@main/services/TopicNamingService', () => ({
  topicNamingService: { maybeRenameAgentSession: mocks.maybeRenameAgentSession }
}))

vi.mock('@main/core/application', () => ({
  application: { get: mocks.applicationGet }
}))

const { AgentChatContextProvider } = await import('../AgentChatContextProvider')
const { runtimeDriverRegistry } = await import('../../../runtime')

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

function openReq(overrides: Partial<AiStreamOpenRequest> = {}): AiStreamOpenRequest {
  return {
    topicId: 'agent-session:session-1',
    trigger: 'submit-message',
    userMessageParts: [{ type: 'text', text: 'hello' }],
    ...overrides
  } as AiStreamOpenRequest
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
      validateSession: vi.fn(),
      listAvailableTools: vi.fn().mockResolvedValue([])
    })
    mocks.getSession.mockResolvedValue({ id: 'session-1', agentId: 'agent-1', workspace: { path: '/tmp' } })
    mocks.getAgent.mockResolvedValue({ id: 'agent-1', type: 'claude-code', model: 'anthropic::claude-sonnet' })
    mocks.saveMessage.mockResolvedValue(undefined)
    mocks.saveMessages.mockResolvedValue(undefined)
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'TraceStorageService') return { setTopicId: mocks.traceStorageSetTopicId }
      if (name === 'AgentSessionRuntimeService') {
        return {
          beginTurn: mocks.runtimeBeginTurn,
          enqueueUserMessage: mocks.runtimeEnqueueUserMessage,
          isSessionBusy: mocks.runtimeIsSessionBusy
        }
      }
      throw new Error(`Unexpected application.get(${name})`)
    })
    mocks.runtimeBeginTurn.mockReturnValue({
      listeners: [makeSubscriber('runtime:persistence'), makeSubscriber('runtime:terminal')],
      turnId: 'turn-1'
    })
    mocks.runtimeIsSessionBusy.mockReturnValue(false)
  })

  it('prepares fresh agent-session dispatch through the long-lived runtime service', async () => {
    const subscriber = makeSubscriber()
    mocks.runtimeIsSessionBusy.mockReturnValue(false)

    const prepared = await provider.prepareDispatch(subscriber, openReq())

    expect(mocks.saveMessages).toHaveBeenCalledOnce()
    expect(mocks.saveMessage).not.toHaveBeenCalled()
    const savedMessages = mocks.saveMessages.mock.calls[0][0].messages
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
    const beginInput = mocks.runtimeBeginTurn.mock.calls[0][0]
    expect(beginInput.traceId).toEqual(expect.any(String))
    expect(mocks.traceStorageSetTopicId).toHaveBeenCalledWith(beginInput.traceId, 'agent-session:session-1')
    expect(mocks.runtimeBeginTurn).toHaveBeenCalledWith({
      sessionId: 'session-1',
      topicId: 'agent-session:session-1',
      agentId: 'agent-1',
      agentType: 'claude-code',
      modelId: 'anthropic::claude-sonnet',
      assistantMessageId: prepared.models[0].request.messageId,
      userMessage: expect.objectContaining({ id: prepared.userMessageId, role: 'user', sessionId: 'session-1' }),
      traceId: beginInput.traceId,
      rootSpanId: expect.any(String)
    })
    expect(prepared.listeners).toEqual([
      subscriber,
      expect.objectContaining({ id: 'runtime:persistence' }),
      expect.objectContaining({ id: 'runtime:terminal' })
    ])
  })

  it('prepares live inject without creating a new runtime turn or assistant placeholder', async () => {
    const subscriber = makeSubscriber()
    mocks.runtimeIsSessionBusy.mockReturnValue(true)

    const prepared = await provider.prepareDispatch(subscriber, openReq())

    expect(mocks.saveMessage).toHaveBeenCalledOnce()
    expect(mocks.saveMessages).not.toHaveBeenCalled()
    expect(mocks.runtimeBeginTurn).not.toHaveBeenCalled()
    expect(mocks.runtimeEnqueueUserMessage).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ role: 'user', sessionId: 'session-1' })
    )
    expect(prepared.models).toEqual([])
    expect(prepared.userMessageId).toEqual(expect.any(String))
    expect(prepared.listeners).toEqual([subscriber])
  })

  it('rejects agent sessions without a registered runtime driver', async () => {
    runtimeDriverRegistry.clearForTest()
    mocks.getAgent.mockResolvedValue({ id: 'agent-1', type: 'custom-runtime', model: 'anthropic::claude-sonnet' })

    await expect(provider.prepareDispatch(makeSubscriber(), openReq())).rejects.toThrow(
      'Unsupported agent runtime type: custom-runtime'
    )
    expect(mocks.saveMessage).not.toHaveBeenCalled()
    expect(mocks.saveMessages).not.toHaveBeenCalled()
  })
})
