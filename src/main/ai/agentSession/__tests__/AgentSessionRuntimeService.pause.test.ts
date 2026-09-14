/**
 * pause() / drainInFlight() write-quiesce contract tests (backup restore, issue #16849).
 *
 * Every state-machine launch target enters through the same synchronous registration and pause
 * gate. Suppressed work stays represented by `runtimeState.launch`, and the final hold release
 * resumes that exact target once.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle/BaseService'

const mocks = vi.hoisted(() => ({
  saveMessage: vi.fn(),
  replaceMessageParts: vi.fn(),
  getLastRuntimeResumeToken: vi.fn(),
  findCrashOrphanedAssistantMessages: vi.fn(),
  resolveCrashOrphanedMessages: vi.fn(),
  maybeRenameAgentSession: vi.fn(),
  applicationGet: vi.fn(),
  startRuntimeTurn: vi.fn(),
  suspendUnadmittedRuntimeTurn: vi.fn().mockResolvedValue(undefined),
  pauseRuntimeTurn: vi.fn(),
  broadcastTopicError: vi.fn(),
  terminateHeldTopicStream: vi.fn(),
  cacheSetShared: vi.fn(),
  cacheDeleteShared: vi.fn(),
  getAgent: vi.fn(),
  ensureTraceId: vi.fn()
}))

vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: { ensureTraceId: mocks.ensureTraceId }
}))

vi.mock('@data/services/AgentService', () => ({
  agentService: { getAgent: mocks.getAgent, onAgentUpdated: () => () => {} }
}))

vi.mock('@data/services/AgentSessionMessageService', () => ({
  agentSessionMessageService: {
    saveMessage: mocks.saveMessage,
    replaceMessageParts: mocks.replaceMessageParts,
    getLastRuntimeResumeToken: mocks.getLastRuntimeResumeToken,
    findCrashOrphanedAssistantMessages: mocks.findCrashOrphanedAssistantMessages,
    resolveCrashOrphanedMessages: mocks.resolveCrashOrphanedMessages
  }
}))

vi.mock('@main/services/TopicNamingService', () => ({
  topicNamingService: { maybeRenameAgentSession: mocks.maybeRenameAgentSession }
}))

vi.mock('@application', () => ({
  application: { get: mocks.applicationGet }
}))

const { AgentSessionRuntimeService } = await import('../AgentSessionRuntimeService')

type Service = InstanceType<typeof AgentSessionRuntimeService>
type LaunchTarget = 'queued-turn' | 'steer-continuation' | 'receive-only' | 'deferred-turn'

type ServiceInternals = {
  entries: Map<string, any>
  pauseHolds: Set<symbol>
  inFlightTurnStarts: Map<string, Promise<void>>
  requestRuntimeLaunch: (entry: any, target: LaunchTarget) => void
  startNextTurn: (entry: any) => Promise<void>
  startContinuationTurn: (entry: any) => Promise<void>
  startReceiveOnlyTurn: (entry: any) => Promise<void>
  startDeferredTurn: (entry: any, turn: any) => void
  runReleaseCompensation: () => void
}

const baseTurnInput = {
  sessionId: 'session-1',
  topicId: 'agent-session:session-1',
  agentId: 'agent-1',
  agentType: 'test-runtime',
  modelId: 'claude-code::claude-sonnet-4-5' as any,
  assistantMessageId: 'assistant-1',
  traceId: 'a'.repeat(32)
}

function userMessage(id: string) {
  return {
    id,
    topicId: 'agent-session:session-1',
    parentId: null,
    role: 'user',
    data: { parts: [{ type: 'text', text: 'hello' }] },
    status: 'success',
    createdAt: '',
    updatedAt: ''
  } as any
}

function internals(service: Service): ServiceInternals {
  return service as unknown as ServiceInternals
}

function entryOf(service: Service) {
  return internals(service).entries.get('session-1')
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const flushLaunch = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function seedQueuedFollowUp(service: Service) {
  service.beginTurn(baseTurnInput)
  service.enqueueUserMessage('session-1', userMessage('user-2'))
  return entryOf(service)
}

function beginClosingConnection(service: Service) {
  service.beginTurn(baseTurnInput)
  const gate = createDeferred<void>()
  const close = vi.fn(() => gate.promise)
  entryOf(service).runtimeState.connection = {
    kind: 'connected',
    connection: { close },
    occupancy: {}
  }
  const closing = service.closeSession('session-1')
  return { close, closing, gate }
}

function stubLaunch(service: Service, target: LaunchTarget, implementation: () => Promise<void> | void) {
  const runtime = internals(service)
  switch (target) {
    case 'queued-turn':
      runtime.startNextTurn = vi.fn(async () => {
        await implementation()
      })
      return runtime.startNextTurn
    case 'steer-continuation':
      runtime.startContinuationTurn = vi.fn(async () => {
        await implementation()
      })
      return runtime.startContinuationTurn
    case 'receive-only':
      runtime.startReceiveOnlyTurn = vi.fn(async () => {
        await implementation()
      })
      return runtime.startReceiveOnlyTurn
    case 'deferred-turn':
      runtime.startDeferredTurn = vi.fn(implementation)
      return runtime.startDeferredTurn
  }
}

describe('AgentSessionRuntimeService pause / drainInFlight', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    vi.clearAllMocks()
    mocks.saveMessage.mockImplementation(({ message }) => ({
      ...message,
      id: message.id ?? 'generated-message-id'
    }))
    mocks.getAgent.mockReturnValue({ id: 'agent-1', type: 'test-runtime', model: baseTurnInput.modelId })
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'AiStreamManager') {
        return {
          startRuntimeTurn: mocks.startRuntimeTurn,
          suspendUnadmittedRuntimeTurn: mocks.suspendUnadmittedRuntimeTurn,
          pauseRuntimeTurn: mocks.pauseRuntimeTurn,
          broadcastTopicError: mocks.broadcastTopicError,
          terminateHeldTopicStream: mocks.terminateHeldTopicStream
        }
      }
      if (name === 'CacheService') {
        return { setShared: mocks.cacheSetShared, getShared: () => undefined, deleteShared: mocks.cacheDeleteShared }
      }
      throw new Error(`Unexpected application.get(${name})`)
    })
  })

  it('suppresses a queued launch before consuming the queue or writing a placeholder', async () => {
    const service = new AgentSessionRuntimeService()
    const entry = seedQueuedFollowUp(service)
    service.pause('restore')

    service.markTurnTerminal('session-1', 'success')
    await flushLaunch()

    expect(entry.runtimeState.queue).toHaveLength(1)
    expect(entry.runtimeState.queue[0].message.id).toBe('user-2')
    expect(entry.runtimeState.launch).toEqual({ kind: 'suppressed', target: 'queued-turn' })
    expect(mocks.saveMessage).not.toHaveBeenCalled()
    expect(mocks.startRuntimeTurn).not.toHaveBeenCalled()
    expect(service.isSessionBusy('session-1')).toBe(true)
  })

  it.each<LaunchTarget>(['steer-continuation', 'receive-only', 'deferred-turn'])(
    'suppresses %s before its launch body can write',
    async (target) => {
      const service = new AgentSessionRuntimeService()
      service.beginTurn({ ...baseTurnInput, userMessage: userMessage('user-1') })
      const entry = entryOf(service)
      const launchBody = stubLaunch(service, target, vi.fn())
      service.pause('restore')

      internals(service).requestRuntimeLaunch(entry, target)
      await flushLaunch()

      expect(entry.runtimeState.launch).toEqual({ kind: 'suppressed', target })
      expect(launchBody).not.toHaveBeenCalled()
      expect(mocks.saveMessage).not.toHaveBeenCalled()
      expect(mocks.startRuntimeTurn).not.toHaveBeenCalled()
    }
  )

  it.each<LaunchTarget>(['queued-turn', 'steer-continuation', 'receive-only', 'deferred-turn'])(
    'resumes one suppressed %s launch exactly once after the final hold',
    async (target) => {
      const service = new AgentSessionRuntimeService()
      service.beginTurn({ ...baseTurnInput, userMessage: userMessage('user-1') })
      const entry = entryOf(service)
      const launchBody = stubLaunch(service, target, vi.fn())
      const first = service.pause('first')
      const last = service.pause('last')

      internals(service).requestRuntimeLaunch(entry, target)
      await flushLaunch()
      expect(entry.runtimeState.launch).toEqual({ kind: 'suppressed', target })

      first.dispose()
      first.dispose()
      await flushLaunch()
      expect(launchBody).not.toHaveBeenCalled()

      last.dispose()
      await flushLaunch()
      await flushLaunch()
      expect(launchBody).toHaveBeenCalledTimes(1)
      expect(entry.runtimeState.launch).toEqual({ kind: 'idle' })
    }
  )

  it.each<LaunchTarget>(['queued-turn', 'steer-continuation', 'receive-only', 'deferred-turn'])(
    'drainInFlight observes a running %s launch',
    async (target) => {
      const service = new AgentSessionRuntimeService()
      service.beginTurn({ ...baseTurnInput, userMessage: userMessage('user-1') })
      const entry = entryOf(service)
      const gate = createDeferred<void>()
      stubLaunch(service, target, () => gate.promise)

      internals(service).requestRuntimeLaunch(entry, target)
      await Promise.resolve()
      const hold = service.pause('restore')

      let settled = false
      const drain = service.drainInFlight({ timeoutMs: 5_000 }).then((result) => {
        settled = true
        return result
      })
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(settled).toBe(false)

      gate.resolve()
      await expect(drain).resolves.toEqual({ stragglerIds: [] })
      expect(internals(service).inFlightTurnStarts.size).toBe(0)
      hold.dispose()
    }
  )

  it('registers a launch synchronously and reports a non-aborted straggler on timeout', async () => {
    const service = new AgentSessionRuntimeService()
    service.beginTurn(baseTurnInput)
    const entry = entryOf(service)
    const gate = createDeferred<void>()
    stubLaunch(service, 'deferred-turn', () => gate.promise)

    internals(service).requestRuntimeLaunch(entry, 'deferred-turn')
    expect(internals(service).inFlightTurnStarts.has('session-1')).toBe(true)
    await Promise.resolve()
    const hold = service.pause('restore')

    await expect(service.drainInFlight({ timeoutMs: 25 })).resolves.toEqual({
      stragglerIds: ['session-1']
    })
    expect(internals(service).inFlightTurnStarts.has('session-1')).toBe(true)

    gate.resolve()
    await flushLaunch()
    expect(internals(service).inFlightTurnStarts.size).toBe(0)
    hold.dispose()
  })

  it('drains a detached-flow finalizer after its runtime entry closes', async () => {
    const service = new AgentSessionRuntimeService()
    service.beginTurn(baseTurnInput)
    const entry = entryOf(service)
    const gate = createDeferred<void>()
    entry.backgroundFlowAccumulators = new Map([
      [
        'assistant-1',
        {
          messageId: 'assistant-1',
          controller: { close: vi.fn() },
          done: gate.promise,
          closed: false,
          latest: { parts: [{ type: 'text', text: 'Late flow' }] }
        }
      ]
    ])
    const hold = service.pause('restore')
    const closing = service.closeSession('session-1')

    let drained = false
    const drain = service.drainInFlight({ timeoutMs: 5_000 }).then((result) => {
      drained = true
      return result
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(drained).toBe(false)

    gate.resolve()
    await closing
    await expect(drain).resolves.toEqual({ stragglerIds: [] })
    hold.dispose()
  })

  it('reports a closing connection as active work after its runtime entry is removed', async () => {
    const service = new AgentSessionRuntimeService()
    const { close, closing, gate } = beginClosingConnection(service)

    expect(service.inspect('session-1')).toBeUndefined()
    expect(close).toHaveBeenCalledOnce()
    expect(service.hasBusySessions()).toBe(true)
    expect(service.listActiveWork()).toEqual([{ id: 'session-1', summary: 'closing=true' }])

    gate.resolve()
    await closing
    expect(service.hasBusySessions()).toBe(false)
    expect(service.listActiveWork()).toEqual([])
  })

  it('drains a closing connection after its runtime entry is removed', async () => {
    const service = new AgentSessionRuntimeService()
    const hold = service.pause('restore')
    const { closing, gate } = beginClosingConnection(service)

    let settled = false
    const drain = service.drainInFlight({ timeoutMs: 5_000 }).then((result) => {
      settled = true
      return result
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(settled).toBe(false)

    gate.resolve()
    await closing
    await expect(drain).resolves.toEqual({ stragglerIds: [] })
    hold.dispose()
  })

  it('drops suppressed work for a session closed while paused', async () => {
    const service = new AgentSessionRuntimeService()
    const entry = seedQueuedFollowUp(service)
    const hold = service.pause('restore')
    service.markTurnTerminal('session-1', 'success')
    await flushLaunch()
    expect(entry.runtimeState.launch.kind).toBe('suppressed')

    void service.closeSession('session-1')
    hold.dispose()
    await flushLaunch()

    expect(service.inspect('session-1')).toBeUndefined()
    expect(mocks.saveMessage).not.toHaveBeenCalled()
    expect(mocks.startRuntimeTurn).not.toHaveBeenCalled()
  })

  it('lists state-machine work without treating an idle session as active', () => {
    const service = new AgentSessionRuntimeService()
    seedQueuedFollowUp(service)
    service.beginTurn({
      ...baseTurnInput,
      sessionId: 'session-2',
      topicId: 'agent-session:session-2'
    })
    service.markTurnTerminal('session-2', 'success')

    expect(service.listActiveWork()).toEqual([
      expect.objectContaining({
        id: 'session-1',
        summary: expect.stringContaining('execution=turn')
      })
    ])
  })
})
