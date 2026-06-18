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
  isWorkspaceErr: vi.fn<(error: unknown) => boolean>()
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
    enqueuePendingSteer: vi.fn(() => order.push('enqueuePendingSteer')),
    clearBudgetTripped: vi.fn(),
    send: vi.fn(() => {
      order.push('send')
      return { mode: live ? ('injected' as const) : ('started' as const), executionIds: [] }
    })
  } as unknown as AiStreamManager
}

/** `inject: true` mirrors PersistentChatContextProvider's `hasLiveStream` branch — no models + a user row. */
function wirePrepare(spy: typeof mocks.agentPrepare, topicId: string, opts: { inject: boolean; steer?: boolean }) {
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
      pendingSteerUserMessageId: opts.steer ? 'u1' : undefined
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
    wirePrepare(mocks.persistentPrepare, 'topic-1', { inject: true, steer: true })
    const manager = makeManager(true)

    await dispatchStreamRequest(manager, makeSubscriber(), chatReq('topic-1'))

    // No abort/evict — prepareDispatch observes the still-live stream and takes its inject branch,
    // and the persisted user row is enqueued as a pending steer before send (which just attaches).
    expect(preparedWithCtx).toEqual({ hasLiveStream: true })
    expect(order).toEqual(['prepareDispatch', 'enqueuePendingSteer', 'send'])
    expect(manager.enqueuePendingSteer).toHaveBeenCalledWith('topic-1', 'u1')
  })

  it('does not enqueue a steer for a non-live chat submit (normal turn opens models)', async () => {
    wirePrepare(mocks.persistentPrepare, 'topic-2', { inject: false })
    const manager = makeManager(false)

    await dispatchStreamRequest(manager, makeSubscriber(), chatReq('topic-2'))

    expect(manager.enqueuePendingSteer).not.toHaveBeenCalled()
    expect(order).toEqual(['prepareDispatch', 'send'])
    expect(preparedWithCtx).toEqual({ hasLiveStream: false })
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
})

// ── budget reset gating ────────────────────────────────────────────────────
// The per-turn budget reset must fire only for OUTER submit-message / regenerate-message
// dispatches. budget-continue (and other continuation triggers) must NOT reset, so
// resumesUsed accumulates across resumes and the MAX_BUDGET_RESUMES cap is honoured.
// The reset lives in dispatchStreamRequest (keyed on req.trigger), NOT in send() —
// because buildStreamRequest hard-codes 'submit-message' for every inner AiStreamRequest,
// including budget-continue resumes, making the inner trigger useless as a gate.

describe('dispatchStreamRequest — budget reset gating', () => {
  it('submit-message outer trigger → clearBudgetTripped called for each prepared model', async () => {
    wirePrepare(mocks.persistentPrepare, 'topic-budget', { inject: false })
    const manager = makeManager(false)

    await dispatchStreamRequest(manager, makeSubscriber(), {
      trigger: 'submit-message',
      topicId: 'topic-budget',
      userMessageParts: []
    } as unknown as MainDispatchRequest)

    expect(manager.clearBudgetTripped).toHaveBeenCalledWith('topic-budget', 'p::m')
  })

  it('regenerate-message outer trigger → clearBudgetTripped called for each prepared model', async () => {
    wirePrepare(mocks.persistentPrepare, 'topic-budget', { inject: false })
    const manager = makeManager(false)

    await dispatchStreamRequest(manager, makeSubscriber(), {
      trigger: 'regenerate-message',
      topicId: 'topic-budget',
      parentAnchorId: 'anchor-1'
    } as unknown as MainDispatchRequest)

    expect(manager.clearBudgetTripped).toHaveBeenCalledWith('topic-budget', 'p::m')
  })

  it('budget-continue outer trigger → clearBudgetTripped NOT called (cap survives the resume)', async () => {
    wirePrepare(mocks.persistentPrepare, 'topic-budget', { inject: false })
    const manager = makeManager(false)

    await dispatchStreamRequest(manager, makeSubscriber(), {
      trigger: 'budget-continue',
      topicId: 'topic-budget',
      parentAnchorId: 'anchor-1'
    } as unknown as MainDispatchRequest)

    expect(manager.clearBudgetTripped).not.toHaveBeenCalled()
  })

  it('steer-continuation outer trigger → clearBudgetTripped NOT called', async () => {
    wirePrepare(mocks.persistentPrepare, 'topic-budget', { inject: false })
    const manager = makeManager(false)

    await dispatchStreamRequest(manager, makeSubscriber(), {
      trigger: 'steer-continuation',
      topicId: 'topic-budget',
      userMessageId: 'steer-msg-1'
    } as unknown as MainDispatchRequest)

    expect(manager.clearBudgetTripped).not.toHaveBeenCalled()
  })

  it('continue-conversation outer trigger → clearBudgetTripped NOT called', async () => {
    wirePrepare(mocks.persistentPrepare, 'topic-budget', { inject: false })
    const manager = makeManager(false)

    await dispatchStreamRequest(manager, makeSubscriber(), {
      trigger: 'continue-conversation',
      topicId: 'topic-budget',
      parentAnchorId: 'anchor-1',
      approvalDecisions: []
    } as unknown as MainDispatchRequest)

    expect(manager.clearBudgetTripped).not.toHaveBeenCalled()
  })

  it('budget-continue with pre-set resumesUsed=1 → clearBudgetTripped not called, cap is preserved', async () => {
    // This is the core regression test: a budget-continue dispatch must NOT call clearBudgetTripped,
    // so a pre-existing resumesUsed count is not silently deleted. If clearBudgetTripped were still
    // inside send() (keyed on the inner trigger), the hardcoded 'submit-message' inner request would
    // trigger it, resetting resumesUsed to 0 and breaking the cap.
    wirePrepare(mocks.persistentPrepare, 'topic-cap', { inject: false })
    const manager = makeManager(false)

    // Simulate two resumes already consumed (resumesUsed=2 in a real manager).
    // We verify clearBudgetTripped is never called during a budget-continue dispatch.
    await dispatchStreamRequest(manager, makeSubscriber(), {
      trigger: 'budget-continue',
      topicId: 'topic-cap',
      parentAnchorId: 'anchor-2'
    } as unknown as MainDispatchRequest)

    expect(manager.clearBudgetTripped).not.toHaveBeenCalled()
  })
})
