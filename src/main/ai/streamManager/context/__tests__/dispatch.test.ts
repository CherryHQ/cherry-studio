import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AiStreamManager } from '../../AiStreamManager'
import type { StreamListener } from '../../types'
import type { MainDispatchRequest } from '../dispatch'

// Records the relative order of the steps we care about (abort vs prepareDispatch).
const order: string[] = []
// Captures the `hasLiveStream` flag the provider receives in its ctx arg.
let preparedWithCtx: { hasLiveStream: boolean } | undefined

const mocks = vi.hoisted(() => ({
  agentCanHandle: vi.fn<(topicId: string) => boolean>(),
  agentPrepare: vi.fn(),
  persistentPrepare: vi.fn(),
  isWorkspaceErr: vi.fn<(error: unknown) => boolean>()
}))

const minimalPrepared = (topicId: string) => ({
  topicId,
  models: [] as unknown[],
  listeners: [] as StreamListener[],
  isMultiModel: false,
  userMessageId: 'u1'
})

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

/** Fake manager whose `abortAndAwait` flips liveness false, mirroring evict-after-settle. */
function makeManager(initiallyLive: boolean): AiStreamManager {
  let live = initiallyLive
  return {
    hasLiveStream: vi.fn(() => live),
    abortAndAwait: vi.fn(async () => {
      order.push('abortAndAwait')
      live = false
    }),
    send: vi.fn(() => {
      order.push('send')
      return { mode: 'started' as const, executionIds: [] }
    })
  } as unknown as AiStreamManager
}

function wirePrepare(spy: typeof mocks.agentPrepare, topicId: string) {
  spy.mockImplementation((_subscriber: StreamListener, _req: MainDispatchRequest, ctx: { hasLiveStream: boolean }) => {
    order.push('prepareDispatch')
    preparedWithCtx = ctx
    return Promise.resolve(minimalPrepared(topicId))
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

describe('dispatchStreamRequest — steer-restart ordering (#B4)', () => {
  it('aborts the live chat turn BEFORE prepareDispatch reads history, and prepares as a fresh start', async () => {
    wirePrepare(mocks.persistentPrepare, 'topic-1')
    const manager = makeManager(true)

    await dispatchStreamRequest(manager, makeSubscriber(), chatReq('topic-1'))

    // abortAndAwait must settle+persist the paused partial before prepareDispatch's DB read.
    expect(order).toEqual(['abortAndAwait', 'prepareDispatch', 'send'])
    expect(manager.abortAndAwait).toHaveBeenCalledWith('topic-1', 'steer-restart')
    // Post-abort the stream is evicted, so the provider sees a fresh start.
    expect(preparedWithCtx).toEqual({ hasLiveStream: false })
  })

  it('does not abort a non-live chat topic', async () => {
    wirePrepare(mocks.persistentPrepare, 'topic-2')
    const manager = makeManager(false)

    await dispatchStreamRequest(manager, makeSubscriber(), chatReq('topic-2'))

    expect(manager.abortAndAwait).not.toHaveBeenCalled()
    expect(order).toEqual(['prepareDispatch', 'send'])
    expect(preparedWithCtx).toEqual({ hasLiveStream: false })
  })

  it('never aborts an agent-session topic and preserves its live flag for the inject path', async () => {
    mocks.agentCanHandle.mockReturnValue(true)
    wirePrepare(mocks.agentPrepare, 'agent-session:s1')
    const manager = makeManager(true)

    await dispatchStreamRequest(manager, makeSubscriber(), chatReq('agent-session:s1'))

    expect(manager.abortAndAwait).not.toHaveBeenCalled()
    expect(order).toEqual(['prepareDispatch', 'send'])
    // Agent session is untouched → prepareDispatch must still observe the live stream.
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
