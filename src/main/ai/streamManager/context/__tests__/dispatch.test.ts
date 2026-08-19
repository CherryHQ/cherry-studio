import type { ReasoningEffortOption } from '@shared/types/aiSdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AiStreamManager } from '../../AiStreamManager'
import type { StreamListener } from '../../types'
import type { MainDispatchRequest } from '../dispatch'

// Records the relative order of the steps we care about (prepareDispatch / enqueue / send).
const order: string[] = []
// Captures the `hasLiveStream` flag the provider receives in its ctx arg.
let preparedWithCtx: { hasLiveStream: boolean } | undefined

const mocks = vi.hoisted(() => ({
  agentCanHandle: vi.fn<(topicId: string) => boolean>(),
  agentPrepare: vi.fn(),
  persistentPrepare: vi.fn(),
  temporaryCanHandle: vi.fn<(topicId: string) => boolean>(),
  temporaryPrepare: vi.fn(),
  isWorkspaceErr: vi.fn<(error: unknown) => boolean>(),
  setActiveNode: vi.fn()
}))

vi.mock('@main/data/services/TopicService', () => ({
  topicService: { setActiveNode: mocks.setActiveNode }
}))

vi.mock('../AgentChatContextProvider', () => ({
  agentChatContextProvider: {
    name: 'agent',
    isPersistentConversation: true,
    canHandle: mocks.agentCanHandle,
    prepareDispatch: mocks.agentPrepare
  }
}))
vi.mock('../TemporaryChatContextProvider', () => ({
  temporaryChatContextProvider: {
    name: 'temporary',
    isPersistentConversation: false,
    canHandle: mocks.temporaryCanHandle,
    prepareDispatch: mocks.temporaryPrepare
  }
}))
vi.mock('../PersistentChatContextProvider', () => ({
  persistentChatContextProvider: {
    name: 'persistent',
    isPersistentConversation: true,
    canHandle: () => true,
    prepareDispatch: mocks.persistentPrepare
  }
}))
vi.mock('../../../runtime/agentSessionWorkspace', () => ({
  isAgentSessionWorkspaceError: mocks.isWorkspaceErr
}))

const { dispatchStreamRequest } = await import('../dispatch')

function makeSubscriber(): StreamListener {
  return { id: 'wc:1', onChunk: vi.fn(), onDone: vi.fn(), onPaused: vi.fn(), onError: vi.fn(), isAlive: () => true }
}

function makeManager(live: boolean): AiStreamManager {
  return {
    hasLiveStream: vi.fn(() => live),
    inspect: vi.fn(() => undefined),
    enqueuePendingSteer: vi.fn(() => order.push('enqueuePendingSteer')),
    send: vi.fn(() => {
      order.push('send')
      return { mode: live ? ('injected' as const) : ('started' as const), activeExecutions: [] }
    })
  } as unknown as AiStreamManager
}

/** `inject: true` mirrors PersistentChatContextProvider's `hasLiveStream` branch — no models + a user row. */
function wirePrepare(
  spy: typeof mocks.agentPrepare,
  topicId: string,
  opts: { inject: boolean; steer?: boolean; reasoningEffort?: ReasoningEffortOption; fastMode?: boolean }
) {
  spy.mockImplementation((_subscriber: StreamListener, _req: MainDispatchRequest, ctx: { hasLiveStream: boolean }) => {
    order.push('prepareDispatch')
    preparedWithCtx = ctx
    return Promise.resolve({
      topicId,
      models: opts.inject ? [] : [{ modelId: 'p::m', request: {} }],
      listeners: [] as StreamListener[],
      // Only the persistent steer branch sets this explicit marker; the dispatcher enqueues off it.
      // Agent-session injects deliberately leave it unset (the runtime owns their follow-ups).
      pendingSteerUserMessageId: opts.steer ? 'u1' : undefined,
      pendingSteerReasoningEffort: opts.reasoningEffort,
      pendingSteerFastMode: opts.fastMode
    })
  })
}

const chatReq = (topicId: string): MainDispatchRequest =>
  ({ topicId, trigger: 'submit-message', userMessageParts: [] }) as unknown as MainDispatchRequest

beforeEach(() => {
  order.length = 0
  preparedWithCtx = undefined
  vi.clearAllMocks()
  mocks.agentCanHandle.mockReturnValue(false)
  mocks.temporaryCanHandle.mockReturnValue(false)
  mocks.isWorkspaceErr.mockReturnValue(false)
})

describe('dispatchStreamRequest — steer', () => {
  it('persists a live chat submit as a steer and enqueues it (no abort, stream stays live)', async () => {
    wirePrepare(mocks.persistentPrepare, 'topic-1', { inject: true, steer: true, reasoningEffort: 'high' })
    const manager = makeManager(true)

    await dispatchStreamRequest(manager, makeSubscriber(), chatReq('topic-1'))

    // No abort/evict — prepareDispatch observes the still-live stream and takes its inject branch,
    // and the persisted user row is enqueued as a pending steer before send (which just attaches).
    expect(preparedWithCtx).toEqual({ hasLiveStream: true })
    expect(order).toEqual(['prepareDispatch', 'enqueuePendingSteer', 'send'])
    expect(manager.enqueuePendingSteer).toHaveBeenCalledWith('topic-1', 'u1', 'high', false)
  })

  it('carries Fast into a queued steer continuation', async () => {
    wirePrepare(mocks.persistentPrepare, 'topic-fast', {
      inject: true,
      steer: true,
      reasoningEffort: 'high',
      fastMode: true
    })
    const manager = makeManager(true)

    await dispatchStreamRequest(manager, makeSubscriber(), chatReq('topic-fast'))

    expect(manager.enqueuePendingSteer).toHaveBeenCalledWith('topic-fast', 'u1', 'high', true)
  })

  it('does not enqueue a steer for a non-live chat submit (normal turn opens models)', async () => {
    wirePrepare(mocks.persistentPrepare, 'topic-2', { inject: false })
    const manager = makeManager(false)

    await dispatchStreamRequest(manager, makeSubscriber(), chatReq('topic-2'))

    expect(manager.enqueuePendingSteer).not.toHaveBeenCalled()
    expect(order).toEqual(['prepareDispatch', 'send'])
    expect(preparedWithCtx).toEqual({ hasLiveStream: false })
    expect(manager.send).toHaveBeenCalledWith(expect.objectContaining({ isPersistentConversation: true }))
  })

  it('snapshots temporary ownership at admission', async () => {
    mocks.temporaryCanHandle.mockReturnValue(true)
    wirePrepare(mocks.temporaryPrepare, 'temporary-1', { inject: false })
    const manager = makeManager(false)

    await dispatchStreamRequest(manager, makeSubscriber(), chatReq('temporary-1'))

    expect(manager.send).toHaveBeenCalledWith(expect.objectContaining({ isPersistentConversation: false }))
  })

  it('never enqueues a chat steer for an agent-session topic (agent runtime owns its follow-ups)', async () => {
    mocks.agentCanHandle.mockReturnValue(true)
    wirePrepare(mocks.agentPrepare, 'agent-session:s1', { inject: true })
    const manager = makeManager(true)

    await dispatchStreamRequest(manager, makeSubscriber(), chatReq('agent-session:s1'))

    // Even though the agent inject shape has no models, the steer enqueue is gated to the
    // persistent provider, so the agent path is untouched and still sees the live stream.
    expect(manager.enqueuePendingSteer).not.toHaveBeenCalled()
    expect(order).toEqual(['prepareDispatch', 'send'])
    expect(preparedWithCtx).toEqual({ hasLiveStream: true })
  })

  // stream-context-1: the workspace-blocked branch was uncovered (the only test stubbed
  // isAgentSessionWorkspaceError to always-false).
  it('returns mode:blocked without sending when prepareDispatch throws a workspace error', async () => {
    mocks.agentCanHandle.mockReturnValue(true)
    mocks.isWorkspaceErr.mockReturnValue(true)
    mocks.agentPrepare.mockRejectedValue(new Error('workspace missing'))
    const manager = makeManager(true)

    const result = await dispatchStreamRequest(manager, makeSubscriber(), chatReq('agent-session:s1'))

    expect(result).toMatchObject({
      mode: 'blocked',
      reason: 'agent-session-workspace',
      message: 'workspace missing'
    })
    expect(manager.send).not.toHaveBeenCalled()
  })

  it('rethrows a non-workspace prepareDispatch error and does not send', async () => {
    mocks.agentCanHandle.mockReturnValue(true)
    mocks.isWorkspaceErr.mockReturnValue(false)
    mocks.agentPrepare.mockRejectedValue(new Error('boom'))
    const manager = makeManager(true)

    await expect(dispatchStreamRequest(manager, makeSubscriber(), chatReq('agent-session:s1'))).rejects.toThrow('boom')
    expect(manager.send).not.toHaveBeenCalled()
  })

  it('validates multi-model placeholders before sending', async () => {
    mocks.persistentPrepare.mockResolvedValue({
      topicId: 'topic-3',
      models: [
        { modelId: 'p::m1', request: { messageId: 'assistant-1' } },
        { modelId: 'p::m2', request: {} }
      ],
      listeners: [] as StreamListener[],
      reservedMessages: [{ id: 'assistant-1', role: 'assistant', parts: [] }]
    })
    const manager = makeManager(false)

    await expect(dispatchStreamRequest(manager, makeSubscriber(), chatReq('topic-3'))).rejects.toThrow(
      'Multi-model dispatch produced 1 assistant reservations for 2 models'
    )
    expect(manager.send).not.toHaveBeenCalled()
  })

  it('activates the reserved assistant when a live-group append settles during preparation', async () => {
    mocks.persistentPrepare.mockResolvedValue({
      topicId: 'topic-append',
      models: [{ modelId: 'p::m2', request: { messageId: 'assistant-2' } }],
      listeners: [] as StreamListener[],
      reservedMessages: [{ id: 'assistant-2', role: 'assistant', parts: [] }],
      liveExecutionChange: {
        mode: 'append',
        groupAnchorMessageId: 'assistant-1',
        parentAnchorId: 'user-1',
        siblingsGroupId: 1,
        activateFallback: true
      },
      preserveActiveNode: true
    })
    const manager = makeManager(true)
    vi.mocked(manager.hasLiveStream).mockReturnValueOnce(true).mockReturnValueOnce(false)

    const result = await dispatchStreamRequest(manager, makeSubscriber(), {
      topicId: 'topic-append',
      trigger: 'regenerate-message',
      parentAnchorId: 'user-1',
      appendToLiveGroupMessageId: 'assistant-1',
      mentionedModelIds: ['p::m2']
    })

    expect(mocks.setActiveNode).toHaveBeenCalledWith('topic-append', 'assistant-2')
    expect(manager.send).toHaveBeenCalledWith(expect.objectContaining({ liveExecutionChange: undefined }))
    expect(result).toMatchObject({ preserveActiveNode: false })
  })
})
