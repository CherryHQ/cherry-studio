/**
 * pause() / drainInFlight() write-quiesce contract tests (backup restore, issue #16849).
 *
 * Contract: `pause(reason?): Disposable` refcounts write-quiesce holds. While any hold is
 * live, autonomous turn starts (`startNextTurn` queued follow-ups, `startContinuationTurn`
 * steer-roll continuations) are suppressed at the TOP of their launch body — before they
 * consume `pendingTurns`/`rollSteerInputs` or write the assistant placeholder row — and the
 * suppression is recorded in `suppressedTurnStarts`. There is no resume(): disposing the
 * LAST hold runs `runReleaseCompensation()`, which re-kicks the suppressed starts (a newer
 * hold or shutdown inherits the debt instead). `drainInFlight({ timeoutMs })` awaits the
 * launches registered in `inFlightTurnStarts` (registered SYNCHRONOUSLY by the schedule*
 * wrappers); it never rejects and never aborts stragglers.
 *
 * Mirrors JobManager's pause/drainInFlight contract and its test style
 * (`src/main/core/job/__tests__/JobManager.pause.test.ts`).
 */

import { BaseService } from '@main/core/lifecycle/BaseService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  saveMessage: vi.fn(),
  getLastRuntimeResumeToken: vi.fn(),
  findPendingAssistantMessageIds: vi.fn(),
  markMessagesError: vi.fn(),
  maybeRenameAgentSession: vi.fn(),
  applicationGet: vi.fn(),
  startRuntimeTurn: vi.fn(),
  pauseRuntimeTurn: vi.fn(),
  broadcastTopicError: vi.fn(),
  terminateHeldTopicStream: vi.fn(),
  cacheSetShared: vi.fn(),
  cacheDeleteShared: vi.fn(),
  getSessionById: vi.fn(),
  getAgent: vi.fn(),
  ensureTraceId: vi.fn()
}))

vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: { getById: mocks.getSessionById, ensureTraceId: mocks.ensureTraceId }
}))

vi.mock('@data/services/AgentService', () => ({
  agentService: { getAgent: mocks.getAgent, onAgentUpdated: () => () => {} }
}))

vi.mock('@data/services/AgentSessionMessageService', () => ({
  agentSessionMessageService: {
    saveMessage: mocks.saveMessage,
    getLastRuntimeResumeToken: mocks.getLastRuntimeResumeToken,
    findPendingAssistantMessageIds: mocks.findPendingAssistantMessageIds,
    markMessagesError: mocks.markMessagesError
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

/** White-box surface for the quiesce plumbing. */
type ServiceInternals = {
  entries: Map<string, any>
  pauseHolds: Set<symbol>
  suppressedTurnStarts: Map<string, 'next' | 'continuation'>
  inFlightTurnStarts: Map<string, Promise<void>>
  scheduleNextTurn: (entry: any) => void
  startNextTurn: (entry: any) => Promise<void>
  startContinuationTurn: (entry: any) => Promise<void>
  runReleaseCompensation: () => void
}

function internals(service: Service): ServiceInternals {
  return service as unknown as ServiceInternals
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Flush the queueMicrotask launch body plus its finally (same idiom as the main suite). */
const flushLaunch = () => sleep(0)

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

/** Live turn + one queued follow-up (`user-2`) sitting in `pendingTurns`. */
function seedQueuedFollowUp(service: Service) {
  service.beginTurn(baseTurnInput)
  service.enqueueUserMessage('session-1', userMessage('user-2'))
  return internals(service).entries.get('session-1')
}

/** Steer roll mid-flight: `rolling` true with `rollSteerInputs` captured, A1a closed. */
function seedRoll(service: Service) {
  service.beginTurn({ ...baseTurnInput, userMessage: userMessage('user-1') })
  const entry = internals(service).entries.get('session-1')
  ;(service as any).handleRuntimeEvent(entry, {
    type: 'steer-boundary',
    inputs: [{ message: userMessage('user-2'), systemReminder: true }]
  })
  return entry
}

describe('AgentSessionRuntimeService pause / drainInFlight', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    vi.clearAllMocks()
    mocks.saveMessage.mockImplementation(({ message }) => ({
      ...message,
      id: message.id ?? 'generated-message-id'
    }))
    // startNextTurn re-reads the live agent before draining — it needs a non-null model.
    mocks.getAgent.mockReturnValue({ id: 'agent-1', type: 'test-runtime', model: baseTurnInput.modelId })
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'AiStreamManager') {
        return {
          startRuntimeTurn: mocks.startRuntimeTurn,
          pauseRuntimeTurn: mocks.pauseRuntimeTurn,
          broadcastTopicError: mocks.broadcastTopicError,
          terminateHeldTopicStream: mocks.terminateHeldTopicStream
        }
      }
      if (name === 'CacheService') return { setShared: mocks.cacheSetShared, deleteShared: mocks.cacheDeleteShared }
      throw new Error(`Unexpected application.get(${name})`)
    })
  })

  // -------------------------------------------------------------------------
  // Blocked surface while paused
  // -------------------------------------------------------------------------

  describe('blocked surface while paused', () => {
    it('suppresses a queued next-turn start: pendingTurns intact, no placeholder write, session stays busy', async () => {
      const service = new AgentSessionRuntimeService()
      const entry = seedQueuedFollowUp(service)
      service.pause('restore')

      service.markTurnTerminal('session-1', 'success') // schedules the drain into the gate
      await flushLaunch()

      // The gate ran BEFORE `pendingTurns.shift()`: the follow-up is still queued and no
      // autonomous DB write (assistant placeholder) landed.
      expect(entry.pendingTurns).toHaveLength(1)
      expect(entry.pendingTurns[0].id).toBe('user-2')
      expect(mocks.saveMessage).not.toHaveBeenCalled()
      expect(mocks.startRuntimeTurn).not.toHaveBeenCalled()
      expect(internals(service).suppressedTurnStarts.get('session-1')).toBe('next')
      // The intact queue keeps the session busy, so a concurrent dispatch still enqueues.
      expect(service.isSessionBusy('session-1')).toBe(true)
    })

    it('suppresses a steer-roll continuation start: rolling stays true, rollSteerInputs unconsumed', async () => {
      const service = new AgentSessionRuntimeService()
      const entry = seedRoll(service)
      service.pause('restore')

      service.markTurnTerminal('session-1', 'success') // rolling → scheduleContinuationTurn
      await flushLaunch()

      // The gate ran BEFORE consuming the roll state: the continuation stays fully re-kickable.
      expect(entry.rolling).toBe(true)
      expect(entry.rollSteerInputs).toBeDefined()
      expect(mocks.saveMessage).not.toHaveBeenCalled()
      expect(mocks.startRuntimeTurn).not.toHaveBeenCalled()
      expect(internals(service).suppressedTurnStarts.get('session-1')).toBe('continuation')
      expect(service.isSessionBusy('session-1')).toBe(true)
    })

    it('clears startingNextTurn once the suppressed launch settles (compensation precondition)', async () => {
      const service = new AgentSessionRuntimeService()
      const entry = seedQueuedFollowUp(service)
      service.pause('restore')

      service.markTurnTerminal('session-1', 'success')
      expect(entry.startingNextTurn).toBe(true) // flag spans the whole drain
      await flushLaunch()

      // The launch's finally ran: `!entry.startingNextTurn` holds, so release
      // compensation is not skipped for this session, and the in-flight map is clean.
      expect(entry.startingNextTurn).toBe(false)
      expect(internals(service).inFlightTurnStarts.size).toBe(0)
      expect(internals(service).suppressedTurnStarts.get('session-1')).toBe('next')
    })
  })

  // -------------------------------------------------------------------------
  // drainInFlight
  // -------------------------------------------------------------------------

  describe('drainInFlight', () => {
    it('returns a clean verdict when nothing is in flight', async () => {
      const service = new AgentSessionRuntimeService()
      const hold = service.pause('restore')

      await expect(service.drainInFlight({ timeoutMs: 200 })).resolves.toEqual({ stragglerIds: [] })

      hold.dispose()
    })

    it('waits for a launch admitted before the pause; clean verdict once it settles', async () => {
      const service = new AgentSessionRuntimeService()
      seedQueuedFollowUp(service)
      // The launch body is fully synchronous (better-sqlite3 saveMessage and the mocked
      // startRuntimeTurn are called without await), so there is no awaited seam INSIDE it
      // to park on — park the launch body itself on a gate to model a start admitted
      // before the pause that is still writing when the drain begins.
      const gate = createDeferred<void>()
      internals(service).startNextTurn = vi.fn(() => gate.promise)

      service.markTurnTerminal('session-1', 'success') // admitted (registered) pre-pause
      const hold = service.pause('restore')

      let settled = false
      const drainP = service.drainInFlight({ timeoutMs: 5_000 }).then((verdict) => {
        settled = true
        return verdict
      })
      await sleep(30)
      expect(settled).toBe(false) // drain is waiting on the parked launch

      gate.resolve()
      await expect(drainP).resolves.toEqual({ stragglerIds: [] })
      expect(internals(service).inFlightTurnStarts.size).toBe(0)

      hold.dispose()
    })

    it('returns straggler ids on timeout without rejecting — and does NOT abort the launch', async () => {
      const service = new AgentSessionRuntimeService()
      seedQueuedFollowUp(service)
      const gate = createDeferred<void>()
      const parked = vi.fn(() => gate.promise)
      internals(service).startNextTurn = parked

      service.markTurnTerminal('session-1', 'success')
      const hold = service.pause('restore')

      const verdict = await service.drainInFlight({ timeoutMs: 50 })
      expect(verdict.stragglerIds).toEqual(['session-1'])

      // The straggler was not aborted: the launch is still registered and only settles
      // when we release it ourselves.
      expect(parked).toHaveBeenCalledTimes(1)
      expect(internals(service).inFlightTurnStarts.has('session-1')).toBe(true)
      gate.resolve()
      await flushLaunch()
      expect(internals(service).inFlightTurnStarts.size).toBe(0)

      hold.dispose()
    })

    it('registers the launch promise synchronously, before the microtask body runs', async () => {
      const service = new AgentSessionRuntimeService()
      const entry = seedQueuedFollowUp(service)

      internals(service).scheduleNextTurn(entry)
      // No await/flush between the schedule call and these assertions: a drain that just
      // awaited the settling stream must see this launch on its next collect.
      expect(internals(service).inFlightTurnStarts.has('session-1')).toBe(true)
      expect(entry.startingNextTurn).toBe(true)

      await flushLaunch() // not paused → the launch runs and cleans up after itself
      expect(internals(service).inFlightTurnStarts.has('session-1')).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // Holds & release compensation
  // -------------------------------------------------------------------------

  describe('holds and release compensation', () => {
    it('refcounts holds; dispose is idempotent; only the last release compensates', async () => {
      const service = new AgentSessionRuntimeService()
      seedQueuedFollowUp(service)
      const h1 = service.pause('holder-1')
      const h2 = service.pause('holder-2')

      service.markTurnTerminal('session-1', 'success')
      await flushLaunch()
      expect(internals(service).suppressedTurnStarts.get('session-1')).toBe('next')

      h1.dispose()
      h1.dispose() // idempotent — must not release h2's hold
      expect(service.isWriteQuiesced).toBe(true)
      await flushLaunch()
      expect(mocks.saveMessage).not.toHaveBeenCalled()

      h2.dispose()
      expect(service.isWriteQuiesced).toBe(false)
      await flushLaunch()
      expect(mocks.saveMessage).toHaveBeenCalledTimes(1)
    })

    it('release re-kicks a suppressed next turn exactly once', async () => {
      const service = new AgentSessionRuntimeService()
      const entry = seedQueuedFollowUp(service)
      const hold = service.pause('restore')
      service.markTurnTerminal('session-1', 'success')
      await flushLaunch()
      expect(internals(service).suppressedTurnStarts.get('session-1')).toBe('next')

      hold.dispose()
      await flushLaunch()
      await flushLaunch()

      // The turn actually started: exactly one placeholder write and one runtime handoff.
      expect(mocks.saveMessage).toHaveBeenCalledTimes(1)
      expect(mocks.saveMessage.mock.calls[0][0].message.role).toBe('assistant')
      expect(mocks.startRuntimeTurn).toHaveBeenCalledTimes(1)
      expect(entry.pendingTurns).toHaveLength(0)
      expect(entry.currentTurn.userMessage.id).toBe('user-2')
      expect(internals(service).suppressedTurnStarts.size).toBe(0)
    })

    it('release re-kicks a suppressed continuation turn', async () => {
      const service = new AgentSessionRuntimeService()
      const entry = seedRoll(service)
      const hold = service.pause('restore')
      service.markTurnTerminal('session-1', 'success')
      await flushLaunch()
      expect(internals(service).suppressedTurnStarts.get('session-1')).toBe('continuation')

      hold.dispose()
      await flushLaunch()
      await flushLaunch()

      // The continuation (A2) opened: placeholder saved, runtime turn started, roll
      // inputs consumed, and the pre-admitted continuation turn is current.
      expect(mocks.saveMessage).toHaveBeenCalledTimes(1)
      expect(mocks.saveMessage.mock.calls[0][0].message.role).toBe('assistant')
      expect(mocks.startRuntimeTurn).toHaveBeenCalledTimes(1)
      expect(entry.rollSteerInputs).toBeUndefined()
      expect(entry.currentTurn.userMessage.id).toBe('user-2')
      expect(entry.currentTurn.admitted).toBe(true)

      service.closeSession('session-1')
    })

    it('a newer hold inherits the suppressed debt; only its release kicks', async () => {
      const service = new AgentSessionRuntimeService()
      const entry = seedQueuedFollowUp(service)
      const holdA = service.pause('restore-a')
      service.markTurnTerminal('session-1', 'success')
      await flushLaunch()
      expect(internals(service).suppressedTurnStarts.get('session-1')).toBe('next')

      const holdB = service.pause('restore-b')
      holdA.dispose()
      await flushLaunch()
      expect(mocks.saveMessage).not.toHaveBeenCalled()
      expect(internals(service).suppressedTurnStarts.get('session-1')).toBe('next')

      // Even a direct compensation call while quiesced must skip WITHOUT draining the
      // map — the debt belongs to the newest hold.
      internals(service).runReleaseCompensation()
      expect(internals(service).suppressedTurnStarts.get('session-1')).toBe('next')

      holdB.dispose()
      await flushLaunch()
      expect(mocks.saveMessage).toHaveBeenCalledTimes(1)
      expect(entry.pendingTurns).toHaveLength(0)
    })

    it('drops the debt for a session closed during the pause window', async () => {
      const service = new AgentSessionRuntimeService()
      const hold = service.pause('restore')
      seedQueuedFollowUp(service)
      service.markTurnTerminal('session-1', 'success')
      await flushLaunch()
      expect(internals(service).suppressedTurnStarts.get('session-1')).toBe('next')

      // Simulate closeEntry having removed the session mid-window.
      internals(service).entries.delete('session-1')

      expect(() => hold.dispose()).not.toThrow()
      await flushLaunch()
      expect(mocks.saveMessage).not.toHaveBeenCalled()
      expect(mocks.startRuntimeTurn).not.toHaveBeenCalled()
      expect(internals(service).suppressedTurnStarts.size).toBe(0)
    })

    it('fails closed: a never-disposed hold keeps the service quiesced and the work suppressed', async () => {
      const service = new AgentSessionRuntimeService()
      const entry = seedQueuedFollowUp(service)
      service.pause('restore — never released')

      service.markTurnTerminal('session-1', 'success')
      await flushLaunch()
      await sleep(20)

      expect(service.isWriteQuiesced).toBe(true)
      expect(internals(service).pauseHolds.size).toBe(1)
      expect(mocks.saveMessage).not.toHaveBeenCalled()
      expect(entry.pendingTurns).toHaveLength(1)
    })
  })

  // -------------------------------------------------------------------------
  // listActiveWork
  // -------------------------------------------------------------------------

  describe('listActiveWork', () => {
    it('lists busy sessions with a pending summary and excludes idle sessions', () => {
      const service = new AgentSessionRuntimeService()
      seedQueuedFollowUp(service) // session-1: live turn + one queued follow-up

      // session-2 settles with nothing queued → idle, excluded.
      service.beginTurn({ ...baseTurnInput, sessionId: 'session-2', topicId: 'agent-session:session-2' })
      service.markTurnTerminal('session-2', 'success')

      const work = service.listActiveWork()
      expect(work).toHaveLength(1)
      expect(work[0].id).toBe('session-1')
      expect(work[0].summary).toContain('turn=live')
      expect(work[0].summary).toContain('pending=1')
    })
  })
})
