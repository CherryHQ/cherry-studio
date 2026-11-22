import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentSessionEditError } from '@data/services/AgentSessionEditError'

import type { StreamListener } from '../../types'
import type { MainDispatchRequest } from '../dispatch'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  ensureTraceIdTx: vi.fn(),
  getAgent: vi.fn(),
  captureHead: vi.fn(),
  branchTip: vi.fn(),
  saveMessage: vi.fn(),
  saveMessagesTx: vi.fn(),
  deleteSessionMessage: vi.fn(),
  hasSessionMessages: vi.fn(),
  maybeRenameAgentSessionFromFirstUserMessage: vi.fn(),
  maybeRenameAgentSession: vi.fn(),
  applicationGet: vi.fn(),
  runtimeBeginTurn: vi.fn(),
  runtimeEnqueueUserMessage: vi.fn(),
  runtimeIsSessionBusy: vi.fn(),
  runtimeAssertWritable: vi.fn(),
  runtimeAssertSessionEditable: vi.fn(),
  runtimeEditSession: vi.fn(),
  runtimeValidateSession: vi.fn(),
  setEditRuntimeTx: vi.fn(),
  reserveDurableBranchTx: vi.fn(),
  getModelNames: vi.fn(() => new Map<string, string>()),
  getModelByKey: vi.fn(),
  readAgentSessionPath: vi.fn((): unknown[] => [])
}))

vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: { getById: mocks.getSession, ensureTraceIdTx: mocks.ensureTraceIdTx }
}))

vi.mock('@data/services/agentSessionMessageTree', () => ({
  getAgentSessionHead: () => mocks.captureHead(),
  readAgentSessionPath: mocks.readAgentSessionPath
}))
vi.mock('@main/ai/runtime/claudeCode', () => ({ reserveClaudeBranchTx: vi.fn() }))
vi.mock('@main/ai/runtime/pi/piContext', () => ({ reservePiBranchTx: vi.fn() }))
vi.mock('@main/ai/runtime/piDurable/durableContext', () => ({ reserveDurableBranchTx: mocks.reserveDurableBranchTx }))

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
    captureHead: mocks.captureHead,
    branchTip: mocks.branchTip,
    saveMessage: mocks.saveMessage,
    saveMessagesTx: mocks.saveMessagesTx,
    deleteSessionMessage: mocks.deleteSessionMessage,
    hasSessionMessages: mocks.hasSessionMessages,
    setEditRuntimeTx: mocks.setEditRuntimeTx
  }
}))

vi.mock('@main/services/TopicNamingService', () => ({
  topicNamingService: {
    maybeRenameAgentSessionFromFirstUserMessage: mocks.maybeRenameAgentSessionFromFirstUserMessage,
    maybeRenameAgentSession: mocks.maybeRenameAgentSession
  }
}))

vi.mock('@data/services/ModelService', () => ({
  modelService: { getNamesByUniqueIdsTx: () => mocks.getModelNames(), getByKey: mocks.getModelByKey }
}))

vi.mock('@application', () => ({
  application: { get: mocks.applicationGet, isReady: () => true }
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
      connect: vi.fn(),
      validateSession: mocks.runtimeValidateSession
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
    mocks.captureHead.mockReturnValue('branch-head')
    mocks.branchTip.mockImplementation((_sessionId, messageId) => messageId)
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'AgentSessionRuntimeService') {
        return {
          prepareBranch: async () => {},
          beginTurn: mocks.runtimeBeginTurn,
          enqueueUserMessage: mocks.runtimeEnqueueUserMessage,
          isSessionBusy: mocks.runtimeIsSessionBusy,
          assertSessionWritable: mocks.runtimeAssertWritable,
          assertSessionEditable: mocks.runtimeAssertSessionEditable,
          editSession: mocks.runtimeEditSession
        }
      }
      if (name === 'DbService') return { getDb: () => ({}), withWriteTx: (fn) => fn({}) }
      throw new Error(`Unexpected application.get(${name})`)
    })
    mocks.runtimeBeginTurn.mockReturnValue({
      listeners: [makeSubscriber('runtime:persistence'), makeSubscriber('runtime:terminal')],
      turnId: 'turn-1'
    })
    mocks.runtimeValidateSession.mockResolvedValue(undefined)
    mocks.runtimeIsSessionBusy.mockReturnValue(false)
    mocks.runtimeEditSession.mockImplementation(async (_sessionId, _target, fn) => fn({}, 'native-session'))
    // History-inclusive image validation is fail-open by default (no replay).
    mocks.readAgentSessionPath.mockReturnValue([])
    // clearAllMocks preserves return values: re-seed the name map so override
    // tests can't leak state into later cases.
    mocks.getModelNames.mockReturnValue(new Map())
  })

  it('keeps the captured branch when the user changes selection during validation', async () => {
    const validation = Promise.withResolvers<void>()
    mocks.runtimeValidateSession.mockReturnValueOnce(validation.promise)
    const dispatch = provider.prepareDispatch(makeSubscriber(), openReq())
    mocks.captureHead.mockReturnValue('other-branch')
    validation.resolve()
    const prepared = await dispatch
    expect(prepared.reservedMessages?.map((message) => message.role)).toEqual(['user', 'assistant'])
    expect(mocks.saveMessagesTx.mock.calls[0][1].parentId).toBe('branch-head')
  })

  it.each([false, true])('rejects a stale append instead of creating an un-forked sibling (busy: %s)', async (busy) => {
    const validation = Promise.withResolvers<void>()
    mocks.runtimeValidateSession.mockReturnValueOnce(validation.promise)
    mocks.runtimeIsSessionBusy.mockReturnValue(busy)
    const dispatch = provider.prepareDispatch(makeSubscriber(), openReq())
    mocks.branchTip.mockReturnValue('newly-appended-message')
    validation.resolve()
    await expect(dispatch).rejects.toMatchObject({ code: 'RESOURCE_LOCKED' })
    expect(mocks.saveMessage).not.toHaveBeenCalled()
    expect(mocks.saveMessagesTx).not.toHaveBeenCalled()
  })

  it.each(['busy', 'close_failed'] as const)(
    'rejects ordinary sends before persistence while edit state is %s',
    async (reason) => {
      mocks.runtimeAssertWritable.mockImplementationOnce(() => {
        throw new AgentSessionEditError(reason)
      })
      await expect(provider.prepareDispatch(makeSubscriber(), openReq())).rejects.toMatchObject({ reason })
      expect(mocks.saveMessage).not.toHaveBeenCalled()
      expect(mocks.saveMessagesTx).not.toHaveBeenCalled()
    }
  )

  it('snapshots the agent avatar identity instead of its URL', async () => {
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      name: 'My Agent',
      type: 'claude-code',
      model: 'anthropic::claude-sonnet',
      modelName: 'Claude Sonnet',
      configuration: { avatar: '🌟' },
      avatarFileId: 'file-1',
      avatarSrc: 'file:///avatar.webp'
    })
    const prepared = await provider.prepareDispatch(makeSubscriber(), openReq())
    const snapshot = prepared.reservedMessages?.find((message) => message.role === 'assistant')?.metadata
      ?.messageSnapshot
    expect(snapshot).toMatchObject({ emoji: '🌟', avatarFileId: 'file-1' })
    expect(JSON.stringify(snapshot)).not.toContain('file:///avatar.webp')
  })

  it('prepares fresh agent-session dispatch through the long-lived runtime service', async () => {
    const subscriber = makeSubscriber()
    mocks.runtimeIsSessionBusy.mockReturnValue(false)

    const prepared = await provider.prepareDispatch(subscriber, openReq())

    expect(mocks.runtimeValidateSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'session-1', workspace: { path: '/tmp' } }),
      { headless: false }
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

  // Without it, a busy Enter in a Pi Durable session would steer the running turn.
  it('forwards the follow-up intent when busy dispatch enqueues a message', async () => {
    mocks.runtimeIsSessionBusy.mockReturnValue(true)

    await provider.prepareDispatch(makeSubscriber(), openReq({ followUp: true }))

    expect(mocks.runtimeEnqueueUserMessage).toHaveBeenCalledWith(
      'session-1',
      expect.anything(),
      expect.objectContaining({ followUp: true })
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

  it('prefers a per-session model override for interactive turns', async () => {
    mocks.getSession.mockReturnValue({
      id: 'session-1',
      agentId: 'agent-1',
      model: 'anthropic::claude-opus',
      workspace: { path: '/tmp' }
    })
    mocks.getModelNames.mockReturnValue(new Map([['anthropic::claude-opus', 'Claude Opus']]))

    const prepared = await provider.prepareDispatch(makeSubscriber(), openReq())

    expect(prepared.models[0].modelId).toBe('anthropic::claude-opus')
    expect(mocks.runtimeBeginTurn).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'anthropic::claude-opus' }))
    expect(mocks.runtimeValidateSession).toHaveBeenCalledWith(expect.objectContaining({ id: 'session-1' }), {
      headless: false
    })
  })

  it('checks the agent default model when editing with a per-session override', async () => {
    mocks.getSession.mockReturnValue({
      id: 'session-1',
      agentId: 'agent-1',
      model: 'anthropic::claude-opus',
      workspace: { path: '/tmp' }
    })
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      name: 'My Agent',
      type: 'claude-code',
      model: 'anthropic::claude-sonnet',
      modelName: 'Claude Sonnet',
      updatedAt: '2026-01-01T00:00:00.000Z'
    })
    mocks.getModelNames.mockReturnValue(new Map([['anthropic::claude-opus', 'Claude Opus']]))

    await provider.prepareDispatch(makeSubscriber(), {
      ...openReq({ userMessageParts: [{ type: 'text', text: 'edited' }] }),
      trigger: 'edit-agent-message',
      editTarget: { messageId: 'msg-1', version: 'v1' }
    } as MainDispatchRequest)

    expect(mocks.saveMessagesTx).toHaveBeenCalledWith({}, expect.anything(), {
      id: 'agent-1',
      updatedAt: '2026-01-01T00:00:00.000Z',
      model: 'anthropic::claude-sonnet',
      type: 'claude-code'
    })
  })

  it.each([undefined, 'context-1'])(
    'preserves durable edit reservation and model-default guard (context: %s)',
    async (nativeContextId) => {
      runtimeDriverRegistry.register({
        type: 'pi-durable',
        connect: vi.fn(),
        validateSession: mocks.runtimeValidateSession
      })
      mocks.getSession.mockReturnValue({
        id: 'session-1',
        agentId: 'agent-1',
        model: 'anthropic::claude-opus',
        workspace: { path: '/tmp' }
      })
      mocks.getAgent.mockReturnValue({
        id: 'agent-1',
        name: 'My Agent',
        type: 'pi-durable',
        model: 'anthropic::claude-sonnet',
        updatedAt: '2026-01-01T00:00:00.000Z'
      })
      mocks.runtimeEditSession.mockImplementation(async (_sessionId, _target, fn) =>
        fn({}, 'native-session', nativeContextId)
      )
      await provider.prepareDispatch(makeSubscriber(), {
        ...openReq({ userMessageParts: [{ type: 'text', text: 'edited' }] }),
        trigger: 'edit-agent-message',
        editTarget: { messageId: 'msg-1', version: 'v1' }
      } as MainDispatchRequest)
      expect(mocks.saveMessagesTx).toHaveBeenCalledWith(
        {},
        expect.anything(),
        expect.objectContaining({ model: 'anthropic::claude-sonnet', type: 'pi-durable' })
      )
      expect(mocks.reserveDurableBranchTx).toHaveBeenCalledWith(
        {},
        'session-1',
        expect.any(String),
        'native-session',
        nativeContextId
      )
      if (nativeContextId)
        expect(mocks.setEditRuntimeTx).toHaveBeenCalledWith({}, 'session-1', expect.any(String), 'native-session')
      else expect(mocks.setEditRuntimeTx).not.toHaveBeenCalled()
    }
  )

  it('keeps headless scheduled runs on the agent default model', async () => {
    mocks.getSession.mockReturnValue({
      id: 'session-1',
      agentId: 'agent-1',
      model: 'anthropic::claude-opus',
      workspace: { path: '/tmp' }
    })

    const prepared = await provider.prepareDispatch(makeSubscriber(), openReq({ headless: true }))

    expect(prepared.models[0].modelId).toBe('anthropic::claude-sonnet')
    expect(mocks.runtimeBeginTurn).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: 'anthropic::claude-sonnet' })
    )
    expect(mocks.runtimeValidateSession).toHaveBeenCalledWith(expect.objectContaining({ id: 'session-1' }), {
      headless: true
    })
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

  describe('multi-image limits (#20030)', () => {
    const imagePart = (filename: string) => ({
      type: 'file',
      url: `file:///tmp/${filename}`,
      mediaType: 'image/png',
      filename
    })
    const twoImages = [imagePart('a.png'), imagePart('b.png')]
    const singleImageModel = {
      id: 'anthropic::claude-sonnet',
      providerId: 'anthropic',
      name: 'Single',
      capabilities: ['image-recognition'],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false,
      maxAgentImages: 1
    }

    beforeEach(() => {
      mocks.getModelByKey.mockReset().mockReturnValue(singleImageModel)
      mocks.deleteSessionMessage.mockReset()
    })

    it('rejects over-limit idle dispatch before committing any rows', async () => {
      mocks.runtimeIsSessionBusy.mockReturnValue(false)

      await expect(
        provider.prepareDispatch(makeSubscriber(), openReq({ userMessageParts: twoImages as any }))
      ).rejects.toMatchObject({ name: 'AgentImageLimitError', limit: 1, count: 2 })

      expect(mocks.saveMessagesTx).not.toHaveBeenCalled()
      expect(mocks.saveMessage).not.toHaveBeenCalled()
      expect(mocks.runtimeBeginTurn).not.toHaveBeenCalled()
      expect(mocks.deleteSessionMessage).not.toHaveBeenCalled()
    })

    it('rejects over-limit busy dispatch before saving the user row', async () => {
      mocks.runtimeIsSessionBusy.mockReturnValue(true)

      await expect(
        provider.prepareDispatch(makeSubscriber(), openReq({ userMessageParts: twoImages as any }))
      ).rejects.toMatchObject({ name: 'AgentImageLimitError', limit: 1, count: 2 })

      expect(mocks.saveMessage).not.toHaveBeenCalled()
      expect(mocks.saveMessagesTx).not.toHaveBeenCalled()
      expect(mocks.runtimeEnqueueUserMessage).not.toHaveBeenCalled()
    })

    it('deletes the saved busy user row when enqueue rejects after the save race', async () => {
      mocks.runtimeIsSessionBusy.mockReturnValue(true)
      // Pre-save validation passes (unlimited at validate time and at the
      // pre-save re-check), then enqueue rejects — the provider must clean up
      // the just-saved row.
      const unlimited = {
        id: 'anthropic::claude-sonnet',
        providerId: 'anthropic',
        name: 'Unlimited',
        capabilities: ['image-recognition'],
        supportsStreaming: true,
        isEnabled: true,
        isHidden: false
      }
      mocks.getModelByKey.mockReset().mockReturnValue(unlimited)
      const { AgentImageLimitError } = await import('@shared/ai/agentImageLimits')
      mocks.runtimeEnqueueUserMessage.mockImplementationOnce(() => {
        throw new AgentImageLimitError({ limit: 1, count: 2, runtime: 'claude-code' })
      })

      await expect(
        provider.prepareDispatch(makeSubscriber(), openReq({ userMessageParts: twoImages as any }))
      ).rejects.toMatchObject({ name: 'AgentImageLimitError' })

      expect(mocks.saveMessage).toHaveBeenCalledOnce()
      expect(mocks.deleteSessionMessage).toHaveBeenCalledWith('session-1', expect.any(String))
    })

    it('deletes committed rows when beginTurn rejects after persist', async () => {
      mocks.runtimeIsSessionBusy.mockReturnValue(false)
      mocks.getModelByKey.mockReturnValue({
        id: 'anthropic::claude-sonnet',
        providerId: 'anthropic',
        name: 'Unlimited',
        capabilities: ['image-recognition'],
        supportsStreaming: true,
        isEnabled: true,
        isHidden: false
      })
      const { AgentImageLimitError } = await import('@shared/ai/agentImageLimits')
      mocks.runtimeBeginTurn.mockImplementationOnce(() => {
        throw new AgentImageLimitError({ limit: 1, count: 2, runtime: 'claude-code' })
      })

      await expect(
        provider.prepareDispatch(makeSubscriber(), openReq({ userMessageParts: twoImages as any }))
      ).rejects.toMatchObject({ name: 'AgentImageLimitError' })

      expect(mocks.saveMessagesTx).toHaveBeenCalledOnce()
      expect(mocks.deleteSessionMessage).toHaveBeenCalledTimes(2)
    })

    it('rejects a text-only continuation that must replay saved workspace images before committing (inv_907b732ecb902515)', async () => {
      // Regression: admitTurn used to reject after the user + assistant rows
      // were committed and the ack cleared the draft. The idle gate now
      // validates the replay payload (history files + new parts) before any
      // write, so zero rows are committed and no stream opens.
      mocks.runtimeIsSessionBusy.mockReturnValue(false)
      mocks.getAgent.mockReturnValue({
        id: 'agent-1',
        name: 'My Agent',
        type: 'pi',
        model: 'anthropic::claude-sonnet',
        modelName: 'Claude Sonnet'
      })
      runtimeDriverRegistry.clearForTest()
      runtimeDriverRegistry.register({
        type: 'pi',
        connect: vi.fn(),
        validateSession: mocks.runtimeValidateSession
      })
      const historyRow = (filename: string) => ({
        id: `hist-${filename}`,
        role: 'user',
        status: 'success',
        data: {
          parts: [{ type: 'file', url: `file:///workspace/${filename}`, mediaType: 'image/png', filename }]
        },
        runtimeResumeToken: null,
        inputContextId: null,
        deliveryStatus: null
      })
      mocks.readAgentSessionPath.mockReturnValue([historyRow('a.png'), historyRow('b.png')])
      await expect(
        provider.prepareDispatch(
          makeSubscriber(),
          openReq({ userMessageParts: [{ type: 'text', text: 'continue' }] as any })
        )
      ).rejects.toMatchObject({ name: 'AgentImageLimitError', limit: 1, count: 2 })
      expect(mocks.saveMessagesTx).not.toHaveBeenCalled()
      expect(mocks.saveMessage).not.toHaveBeenCalled()
      expect(mocks.runtimeBeginTurn).not.toHaveBeenCalled()
      expect(mocks.deleteSessionMessage).not.toHaveBeenCalled()
    })

    it('permits manual /compact with replayed images on Pi without submitting replay (inv_dae5bb8beabb913b)', async () => {
      // Both Pi drivers compact without submitting replay, so the idle gate
      // skips replay validation for `/compact`. Claude keeps gating because it
      // has no manual-compact bypass.
      mocks.runtimeIsSessionBusy.mockReturnValue(false)
      const historyRow = (filename: string) => ({
        id: `hist-${filename}`,
        role: 'user',
        status: 'success',
        data: {
          parts: [{ type: 'file', url: `file:///workspace/${filename}`, mediaType: 'image/png', filename }]
        },
        runtimeResumeToken: null,
        inputContextId: null,
        deliveryStatus: null
      })
      mocks.readAgentSessionPath.mockReturnValue([historyRow('a.png'), historyRow('b.png')])
      const compactParts = [{ type: 'text', text: '/compact keep facts' }] as any
      for (const agentType of ['pi', 'pi-durable'] as const) {
        mocks.getAgent.mockReturnValue({
          id: 'agent-1',
          name: 'My Agent',
          type: agentType,
          model: 'anthropic::claude-sonnet',
          modelName: 'Claude Sonnet'
        })
        runtimeDriverRegistry.clearForTest()
        runtimeDriverRegistry.register({
          type: agentType,
          connect: vi.fn(),
          validateSession: mocks.runtimeValidateSession
        })
        await provider.prepareDispatch(makeSubscriber(), openReq({ userMessageParts: compactParts }))
        expect(mocks.saveMessagesTx).toHaveBeenCalled()
        mocks.saveMessagesTx.mockClear()
        mocks.runtimeBeginTurn.mockClear()
      }
      mocks.getAgent.mockReturnValue({
        id: 'agent-1',
        name: 'My Agent',
        type: 'claude-code',
        model: 'anthropic::claude-sonnet',
        modelName: 'Claude Sonnet'
      })
      runtimeDriverRegistry.clearForTest()
      runtimeDriverRegistry.register({
        type: 'claude-code',
        connect: vi.fn(),
        validateSession: mocks.runtimeValidateSession
      })
      await expect(
        provider.prepareDispatch(makeSubscriber(), openReq({ userMessageParts: compactParts }))
      ).rejects.toMatchObject({ name: 'AgentImageLimitError', limit: 1, count: 2 })
    })

    it('rejects split /compact and delivery-prefixed /compact while genuine /compact passes (inv_a799a7c78eb893f7)', async () => {
      // Drivers join text parts via `buildAgentUserContent` and prefix delivery
      // wrappers: `Compare these` + `/compact` as separate parts, or any
      // delivery-prefixed `/compact`, submits an ordinary turn and must gate.
      mocks.runtimeIsSessionBusy.mockReturnValue(false)
      mocks.getAgent.mockReturnValue({
        id: 'agent-1',
        name: 'My Agent',
        type: 'pi',
        model: 'anthropic::claude-sonnet',
        modelName: 'Claude Sonnet'
      })
      runtimeDriverRegistry.clearForTest()
      runtimeDriverRegistry.register({ type: 'pi', connect: vi.fn(), validateSession: mocks.runtimeValidateSession })
      const historyRow = (filename: string) => ({
        id: `hist-${filename}`,
        role: 'user',
        status: 'success',
        data: {
          parts: [{ type: 'file', url: `file:///workspace/${filename}`, mediaType: 'image/png', filename }]
        },
        runtimeResumeToken: null,
        inputContextId: null,
        deliveryStatus: null
      })
      mocks.readAgentSessionPath.mockReturnValue([historyRow('a.png'), historyRow('b.png')])
      const splitCompact = [
        { type: 'text', text: 'Compare these' },
        { type: 'text', text: '/compact' }
      ] as any
      await expect(
        provider.prepareDispatch(makeSubscriber(), openReq({ userMessageParts: splitCompact }))
      ).rejects.toMatchObject({ name: 'AgentImageLimitError', limit: 1, count: 2 })
      mocks.saveMessagesTx.mockClear()
      // Delivery-prefixed `/compact` never compacts (security-notice prefix),
      // so it must also gate.
      const deliveryCompact = [{ type: 'text', text: '/compact' }] as any
      await expect(
        provider.prepareDispatch(
          makeSubscriber(),
          openReq({
            userMessageParts: deliveryCompact,
            agentDeliveryMessage: {
              id: 'delivery-1',
              sessionId: 'session-1',
              role: 'user',
              data: { parts: deliveryCompact },
              delivery: { sender: 'a', receiver: 'b' }
            } as any
          })
        )
      ).rejects.toMatchObject({ name: 'AgentImageLimitError', limit: 1, count: 2 })
      mocks.saveMessagesTx.mockClear()
      // Genuine single-part `/compact` still reaches compaction (no rejection,
      // rows committed).
      mocks.readAgentSessionPath.mockReturnValue([historyRow('a.png'), historyRow('b.png')])
      await provider.prepareDispatch(
        makeSubscriber(),
        openReq({ userMessageParts: [{ type: 'text', text: '/compact keep facts' }] as any })
      )
      expect(mocks.saveMessagesTx).toHaveBeenCalled()
    })

    it('permits text-only edits that remove workspace images (inv_e5b3b1538d5182fc)', async () => {
      // The first turn saved two workspace PNGs and failed before binding
      // native input. Editing that turn to text-only must pass: the
      // preliminary tip check would count the message being replaced, so edit
      // dispatches validate only fresh parts up front and defer history to the
      // transactional retained-prefix check.
      mocks.runtimeIsSessionBusy.mockReturnValue(false)
      mocks.getAgent.mockReturnValue({
        id: 'agent-1',
        name: 'My Agent',
        type: 'pi',
        model: 'anthropic::claude-sonnet',
        modelName: 'Claude Sonnet'
      })
      runtimeDriverRegistry.clearForTest()
      runtimeDriverRegistry.register({ type: 'pi', connect: vi.fn(), validateSession: mocks.runtimeValidateSession })
      // Preliminary tip contains the message being replaced (two images);
      // transactional retained prefix (post-reset head) contains no images.
      mocks.captureHead.mockReturnValueOnce('tip-with-two-images').mockReturnValue('retained-prefix')
      const tipRow = (filename: string) => ({
        id: `tip-${filename}`,
        role: 'user',
        status: 'success',
        data: {
          parts: [{ type: 'file', url: `file:///workspace/${filename}`, mediaType: 'image/png', filename }]
        },
        runtimeResumeToken: null,
        inputContextId: null,
        deliveryStatus: null
      })
      mocks.readAgentSessionPath.mockImplementation(((_db: unknown, _sessionId: string, parentId: string) => {
        if (parentId === 'tip-with-two-images') return [tipRow('a.png'), tipRow('b.png')]
        return []
      }) as any)
      mocks.runtimeEditSession.mockImplementation(async (_sessionId, _target, fn) => fn({}, 'native-session'))
      await provider.prepareDispatch(makeSubscriber(), {
        ...openReq({ userMessageParts: [{ type: 'text', text: 'text-only replacement' }] as any }),
        trigger: 'edit-agent-message',
        editTarget: { messageId: 'msg-1', version: 'v1' }
      } as MainDispatchRequest)
      expect(mocks.saveMessagesTx).toHaveBeenCalled()
    })

    it('skips history scans for uncapped models (inv_c23ccc3159f3a2b9)', async () => {
      // With no finite cap both fresh and routed checks are no-ops — the idle
      // gate must return before the synchronous full-path history read.
      mocks.runtimeIsSessionBusy.mockReturnValue(false)
      mocks.getModelByKey.mockReturnValue({
        id: 'anthropic::claude-sonnet',
        providerId: 'anthropic',
        name: 'Unlimited',
        capabilities: ['image-recognition'],
        supportsStreaming: true,
        isEnabled: true,
        isHidden: false
      })
      mocks.readAgentSessionPath.mockClear()
      await provider.prepareDispatch(
        makeSubscriber(),
        openReq({ userMessageParts: [{ type: 'text', text: 'continue' }] as any })
      )
      expect(mocks.readAgentSessionPath).not.toHaveBeenCalled()
      expect(mocks.saveMessagesTx).toHaveBeenCalled()
    })
  })
})
