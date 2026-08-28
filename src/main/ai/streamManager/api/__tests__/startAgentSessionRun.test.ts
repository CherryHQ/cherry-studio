import { BaseService } from '@main/core/lifecycle/BaseService'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { StreamListener } from '../../types'

const events: string[] = []
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
        siblingsGroupId: undefined,
        lifecycle: undefined
      })
    )
  })
})

const { sessionGetById, runtimeBusy } = vi.hoisted(() => ({
  sessionGetById: vi.fn(),
  runtimeBusy: vi.fn(() => false)
}))

vi.mock('../../context/AgentChatContextProvider', () => ({
  agentChatContextProvider: { prepareAgentSessionDispatch: prepareDispatchMock }
}))

vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: { getById: sessionGetById }
}))

const managerHolder: { current: unknown } = { current: undefined }
vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'AiStreamManager') return managerHolder.current
      if (name === 'AgentSessionRuntimeService') return { isSessionBusy: runtimeBusy }
      throw new Error(`startAgentSessionRun.test: unexpected application.get('${name}')`)
    }
  }
}))

const { AiStreamManager } = await import('../../AiStreamManager')
const { startAgentSessionRun } = await import('../startAgentSessionRun')

type ManagerInstance = InstanceType<typeof AiStreamManager>

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
const text = (value: string) => ({ type: 'text' as const, text: value })
function listener(id: string): StreamListener {
  return { id, onChunk: vi.fn(), onDone: vi.fn(), onPaused: vi.fn(), onError: vi.fn(), isAlive: () => true }
}

describe('startAgentSessionRun — per-topic dispatch serialization', () => {
  let sendSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    BaseService.resetInstances()
    events.length = 0
    prepareResolvers.length = 0
    prepareDispatchMock.mockClear()
    sessionGetById.mockReset().mockReturnValue({ agentId: 'agent-1' })
    runtimeBusy.mockReset().mockReturnValue(false)

    const Ctor = AiStreamManager as unknown as new () => ManagerInstance
    const manager = new Ctor()
    managerHolder.current = manager
    vi.spyOn(manager, 'hasLiveStream').mockReturnValue(false)
    sendSpy = vi.spyOn(manager, 'send').mockImplementation((input: { topicId: string }) => {
      events.push(`send:${input.topicId}`)
      return { mode: 'started', activeExecutions: [] }
    }) as unknown as ReturnType<typeof vi.spyOn>
  })

  afterEach(() => {
    BaseService.resetInstances()
  })

  it('serializes two concurrent runs on the same Session', async () => {
    const first = startAgentSessionRun({ sessionId: 's1', userParts: [text('a')], listeners: [listener('l1')] })
    const second = startAgentSessionRun({ sessionId: 's1', userParts: [text('b')], listeners: [listener('l2')] })
    await flush()

    expect(events).toEqual(['prepare:agent-session:s1:0'])

    prepareResolvers[0]()
    await flush()
    await first
    expect(events).toEqual(['prepare:agent-session:s1:0', 'send:agent-session:s1', 'prepare:agent-session:s1:1'])

    prepareResolvers[1]()
    await flush()
    await second
    expect(events).toEqual([
      'prepare:agent-session:s1:0',
      'send:agent-session:s1',
      'prepare:agent-session:s1:1',
      'send:agent-session:s1'
    ])
  })

  it('does not serialize runs on different Sessions', async () => {
    const first = startAgentSessionRun({ sessionId: 'a', userParts: [text('a')], listeners: [listener('la')] })
    const second = startAgentSessionRun({ sessionId: 'b', userParts: [text('b')], listeners: [listener('lb')] })
    await flush()

    expect(events).toEqual(['prepare:agent-session:a:0', 'prepare:agent-session:b:1'])
    prepareResolvers[0]()
    prepareResolvers[1]()
    await flush()
    await Promise.all([first, second])
  })

  it('forwards extra listeners to send', async () => {
    const primary = listener('primary')
    const extra = listener('extra')
    const run = startAgentSessionRun({ sessionId: 's', userParts: [text('a')], listeners: [primary, extra] })
    await flush()
    prepareResolvers[0]()
    await flush()
    await run

    expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({ listeners: [primary, extra] }))
  })

  it('passes notification authority through the Agent Session admission contract', async () => {
    const primary = listener('task')
    const trustedNotifyChannels = [{ id: 'channel-1', type: 'telegram' }] as const
    const run = startAgentSessionRun({
      sessionId: 's',
      userParts: [text('scheduled')],
      listeners: [primary],
      trustedNotifyChannels
    })
    await flush()

    const [, request, authority] = prepareDispatchMock.mock.calls[0] as unknown as [
      StreamListener,
      { topicId: string },
      unknown
    ]
    expect(request).not.toHaveProperty('trustedNotifyChannels')
    expect(authority).toEqual({ trustedNotifyChannels })

    prepareResolvers[0]()
    await run
  })

  it('returns busy before preparing a task turn', async () => {
    const manager = managerHolder.current as ManagerInstance
    vi.spyOn(manager, 'hasLiveStream').mockReturnValue(true)

    await expect(
      startAgentSessionRun({
        sessionId: 's',
        userParts: [text('scheduled')],
        listeners: [listener('task')],
        requireIdle: { expectedAgentId: 'agent-1' }
      })
    ).resolves.toEqual({ mode: 'not-started', reason: 'busy' })

    expect(prepareDispatchMock).not.toHaveBeenCalled()
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('returns busy when the runtime becomes active during preparation', async () => {
    prepareDispatchMock.mockRejectedValueOnce(
      DataApiErrorFactory.resourceLocked('Agent session', 's', 'an active turn') as never
    )

    await expect(
      startAgentSessionRun({
        sessionId: 's',
        userParts: [text('scheduled')],
        listeners: [listener('task')],
        requireIdle: { expectedAgentId: 'agent-1' }
      })
    ).resolves.toEqual({ mode: 'not-started', reason: 'busy' })

    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('places task listeners before the runtime terminal listener', async () => {
    const runtimeTerminal = listener('agent-runtime:s')
    prepareDispatchMock.mockImplementationOnce(async (primary: StreamListener, req: { topicId: string }) => ({
      topicId: req.topicId,
      models: [],
      listeners: [primary, runtimeTerminal],
      isMultiModel: false
    }))
    const task = listener('task')
    const channel = listener('channel')

    await startAgentSessionRun({
      sessionId: 's',
      userParts: [text('scheduled')],
      listeners: [task, channel],
      requireIdle: { expectedAgentId: 'agent-1' }
    })

    expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({ listeners: [task, channel, runtimeTerminal] }))
  })
})
