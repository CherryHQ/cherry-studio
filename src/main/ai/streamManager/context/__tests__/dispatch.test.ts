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
  isWorkspaceErr: vi.fn<(error: unknown) => boolean>(),
  deleteMessage: vi.fn(),
  setActiveNode: vi.fn()
}))

vi.mock('@main/data/services/MessageService', () => ({
  messageService: { delete: mocks.deleteMessage }
}))

vi.mock('@main/data/services/TopicService', () => ({
  topicService: { setActiveNode: mocks.setActiveNode }
}))

vi.mock('../AgentChatContextProvider', () => ({
  agentChatContextProvider: {
    name: 'agent',
    canHandle: mocks.agentCanHandle,
    prepareDispatch: mocks.agentPrepare
  }
}))
vi.mock('../TemporaryChatContextProvider', () => ({
  temporaryChatContextProvider: { name: 'temporary', canHandle: () => false, prepareDispatch: vi.fn() }
}))
vi.mock('../PersistentChatContextProvider', () => ({
  persistentChatContextProvider: {
    name: 'persistent',
    canHandle: () => true,
    prepareDispatch: mocks.persistentPrepare
  }
}))
vi.mock('../../../runtime/claudeCode/settingsBuilder', () => ({
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
      return { mode: live ? ('injected' as const) : ('started' as const), executionIds: [], activeExecutions: [] }
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
      isMultiModel: false,
      userMessageId: 'u1',
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
  mocks.isWorkspaceErr.mockReturnValue(false)
})

describe('dispatchStreamRequest — steer', () => {
  it('persists a live chat submit as a steer and enqueues it (no abort, stream stays live)', async () => {
    wirePrepare(mocks.persistentPrepare, 'topic-1', { inject: true, steer: true, reasoningEffort: 'high' })
    const manager = makeManager(true)

    await dispatchStreamRequest(manager, makeSubscriber(), chatReq('topic-1'))

    // No abort/evict — prepareDispatch observes the still-live stream and takes its inject branch,
    // and the persisted user row is enqueued as a pending steer before send (which just attaches).
    expect(preparedWithCtx).toEqual({ hasLiveStream: true, activeExecutions: undefined })
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
    expect(preparedWithCtx).toEqual({ hasLiveStream: false, activeExecutions: undefined })
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
    expect(preparedWithCtx).toEqual({ hasLiveStream: true, activeExecutions: undefined })
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
      isMultiModel: true
    })
    const manager = makeManager(false)

    await expect(dispatchStreamRequest(manager, makeSubscriber(), chatReq('topic-3'))).rejects.toThrow(
      'Multi-model dispatch produced 1 placeholderIds for 2 models'
    )
    expect(manager.send).not.toHaveBeenCalled()
  })

  it('activates the reserved assistant when a live-group append settles during preparation', async () => {
    mocks.persistentPrepare.mockResolvedValue({
      topicId: 'topic-append',
      models: [{ modelId: 'p::m2', request: { messageId: 'assistant-2' } }],
      listeners: [] as StreamListener[],
      reservedMessages: [{ id: 'assistant-2', role: 'assistant', parts: [] }],
      appendLiveExecution: true,
      appendLiveGroupAnchorMessageId: 'assistant-1',
      preserveActiveNode: true,
      isMultiModel: true
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
    expect(manager.send).toHaveBeenCalledWith(expect.objectContaining({ appendLiveExecution: false }))
    expect(result).toMatchObject({ preserveActiveNode: false })
  })

  it('falls back when a different live group replaces the append target during preparation', async () => {
    mocks.persistentPrepare.mockResolvedValue({
      topicId: 'topic-append-race',
      models: [{ modelId: 'p::m2', request: { messageId: 'assistant-2' } }],
      listeners: [] as StreamListener[],
      reservedMessages: [{ id: 'assistant-2', role: 'assistant', parts: [] }],
      appendLiveExecution: true,
      appendLiveGroupAnchorMessageId: 'assistant-1',
      preserveActiveNode: true,
      isMultiModel: true
    })
    const manager = makeManager(true)
    vi.mocked(manager.inspect)
      .mockReturnValueOnce({ executions: [{ anchorMessageId: 'assistant-1' }] } as never)
      .mockReturnValueOnce({ executions: [{ anchorMessageId: 'new-turn-assistant' }] } as never)

    await expect(
      dispatchStreamRequest(manager, makeSubscriber(), {
        topicId: 'topic-append-race',
        trigger: 'regenerate-message',
        parentAnchorId: 'user-1',
        appendToLiveGroupMessageId: 'assistant-1',
        mentionedModelIds: ['p::m2']
      })
    ).rejects.toThrow('live reply group changed')

    expect(mocks.deleteMessage).toHaveBeenCalledWith('assistant-2')
    expect(mocks.setActiveNode).not.toHaveBeenCalled()
    expect(manager.send).not.toHaveBeenCalled()
  })

  it('restores an in-place retry reservation when its live group changes before handoff', async () => {
    const rollbackReservation = vi.fn()
    mocks.persistentPrepare.mockResolvedValue({
      topicId: 'topic-retry-race',
      models: [{ modelId: 'p::m2', request: { messageId: 'assistant-2' } }],
      listeners: [] as StreamListener[],
      reservedMessages: [{ id: 'assistant-2', role: 'assistant', parts: [] }],
      appendLiveExecution: true,
      appendLiveGroupAnchorMessageId: 'assistant-1',
      activateAppendFallback: false,
      preserveActiveNode: true,
      rollbackReservation,
      isMultiModel: false
    })
    const manager = makeManager(true)
    vi.mocked(manager.inspect)
      .mockReturnValueOnce({ executions: [{ anchorMessageId: 'assistant-1' }] } as never)
      .mockReturnValueOnce({ executions: [{ anchorMessageId: 'new-turn-assistant' }] } as never)

    await expect(
      dispatchStreamRequest(manager, makeSubscriber(), {
        topicId: 'topic-retry-race',
        trigger: 'regenerate-message',
        parentAnchorId: 'user-1',
        retryMessageId: 'assistant-2'
      })
    ).rejects.toThrow('live reply group changed')

    expect(rollbackReservation).toHaveBeenCalledTimes(1)
    expect(mocks.deleteMessage).not.toHaveBeenCalled()
    expect(manager.send).not.toHaveBeenCalled()
  })

  it('does not rollback after manager.send reaches its execution commit point and throws', async () => {
    const rollbackReservation = vi.fn()
    mocks.persistentPrepare.mockResolvedValue({
      topicId: 'topic-post-commit-error',
      models: [{ modelId: 'p::m2', request: { messageId: 'assistant-2' } }],
      listeners: [] as StreamListener[],
      reservedMessages: [{ id: 'assistant-2', role: 'assistant', parts: [] }],
      rollbackReservation,
      isMultiModel: false
    })
    const manager = makeManager(false)
    vi.mocked(manager.send).mockImplementation(() => {
      throw new Error('post-commit lifecycle failure')
    })

    await expect(dispatchStreamRequest(manager, makeSubscriber(), chatReq('topic-post-commit-error'))).rejects.toThrow(
      'post-commit lifecycle failure'
    )

    expect(rollbackReservation).not.toHaveBeenCalled()
  })
})
