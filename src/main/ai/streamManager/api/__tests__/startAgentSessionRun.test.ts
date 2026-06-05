import { BaseService } from '@main/core/lifecycle/BaseService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { StreamListener } from '../../types'

// Relative order of prepareDispatch (writes the PENDING placeholder) vs send, across runs.
const events: string[] = []
// Deferred resolvers so the test controls when each run's prepareDispatch completes.
const prepareResolvers: Array<() => void> = []

const prepareDispatchMock = vi.fn((primary: StreamListener, req: { topicId: string }) => {
  const seq = prepareResolvers.length
  events.push(`prepare:${req.topicId}:${seq}`)
  return new Promise((resolve) => {
    prepareResolvers.push(() =>
      resolve({
        topicId: req.topicId,
        models: [],
        listeners: [primary],
        isMultiModel: false,
        userMessage: undefined,
        siblingsGroupId: undefined,
        lifecycle: undefined
      })
    )
  })
})

vi.mock('../../context/AgentChatContextProvider', () => ({
  agentChatContextProvider: { prepareDispatch: prepareDispatchMock }
}))

// startAgentSessionRun reaches for `application.get('AiStreamManager')`; hand it a real
// manager so the actual `withDispatchLock` / `dispatchLock` serialization is exercised.
const managerHolder: { current: unknown } = { current: undefined }
vi.mock('@main/core/application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'AiStreamManager') return managerHolder.current
      throw new Error(`startAgentSessionRun.test: unexpected application.get('${name}')`)
    }
  }
}))

const { AiStreamManager } = await import('../../AiStreamManager')
const { startAgentSessionRun } = await import('../startAgentSessionRun')

type ManagerInstance = InstanceType<typeof AiStreamManager>

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
const text = (t: string) => ({ type: 'text' as const, text: t })
function listener(id: string): StreamListener {
  return { id, onChunk: vi.fn(), onDone: vi.fn(), onPaused: vi.fn(), onError: vi.fn(), isAlive: () => true }
}

describe('startAgentSessionRun — per-topic dispatch serialization (B2 agent-session path)', () => {
  let sendSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    BaseService.resetInstances()
    events.length = 0
    prepareResolvers.length = 0
    prepareDispatchMock.mockClear()

    const Ctor = AiStreamManager as unknown as new () => ManagerInstance
    const manager = new Ctor()
    managerHolder.current = manager
    vi.spyOn(manager, 'hasLiveStream').mockReturnValue(false)
    sendSpy = vi.spyOn(manager, 'send').mockImplementation((input: { topicId: string }) => {
      events.push(`send:${input.topicId}`)
      return { mode: 'started', executionIds: [] }
    }) as unknown as ReturnType<typeof vi.spyOn>
  })

  afterEach(() => {
    BaseService.resetInstances()
  })

  it('serializes two concurrent runs on the same session — the second prepares only after the first sends', async () => {
    const p1 = startAgentSessionRun({ sessionId: 's1', userParts: [text('a')], listeners: [listener('l1')] })
    const p2 = startAgentSessionRun({ sessionId: 's1', userParts: [text('b')], listeners: [listener('l2')] })
    await flush()

    // Only the first run is inside prepareDispatch; the second is parked on the per-topic lock,
    // so it can't read `hasLiveStream` / write its placeholder yet.
    expect(events).toEqual(['prepare:agent-session:s1:0'])

    prepareResolvers[0]()
    await flush()
    await p1

    // First sent → lock released → second now prepares.
    expect(events).toEqual(['prepare:agent-session:s1:0', 'send:agent-session:s1', 'prepare:agent-session:s1:1'])

    prepareResolvers[1]()
    await flush()
    await p2
    expect(events).toEqual([
      'prepare:agent-session:s1:0',
      'send:agent-session:s1',
      'prepare:agent-session:s1:1',
      'send:agent-session:s1'
    ])
  })

  it('does not serialize runs on different sessions — the lock is per-topic', async () => {
    const pa = startAgentSessionRun({ sessionId: 'a', userParts: [text('a')], listeners: [listener('la')] })
    const pb = startAgentSessionRun({ sessionId: 'b', userParts: [text('b')], listeners: [listener('lb')] })
    await flush()

    expect(events).toEqual(['prepare:agent-session:a:0', 'prepare:agent-session:b:1'])

    prepareResolvers[0]()
    prepareResolvers[1]()
    await flush()
    await Promise.all([pa, pb])
  })

  it('forwards the extra listeners (the reason it can not just use dispatch()) to send', async () => {
    const primary = listener('primary')
    const extra = listener('extra')
    const run = startAgentSessionRun({ sessionId: 's', userParts: [text('a')], listeners: [primary, extra] })
    await flush()
    prepareResolvers[0]()
    await flush()
    await run

    expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({ listeners: [primary, extra] }))
  })
})
