/**
 * pause() / drainInFlight() write-quiesce contract tests (backup restore, issue #16849).
 *
 * Contract: `pause(reason?): Disposable` gates new-turn ADMISSION — `dispatch()`
 * resolves `{mode:'blocked', reason:'paused'}` (re-checked under the per-topic
 * lock), `startAgentSessionRun` throws before `prepareDispatch` writes rows, and
 * queued steer continuations are suppressed (not consumed). `steer-continuation`
 * dispatches are exempt (grandfathered launches are drain-visible instead).
 * `drainInFlight({timeoutMs})` awaits persistence-bearing loop promises,
 * in-flight steer-continuation launches, and the detached naming writes as a
 * fixed point over promise identities; it never rejects and never aborts
 * stragglers. There is no resume(): holds are refcounted, dispose is
 * idempotent, and only the LAST disposal runs the release compensation that
 * re-kicks suppressed continuations — a newer hold inherits the debt, and a
 * dropped hold fails closed.
 */

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ActiveStream, AiStreamManagerConfig, StreamListener } from '../types'

// ── Mocks ───────────────────────────────────────────────────────────

// `dispatchStreamRequest` is the work the admission gate must sit in front of.
// Deferred so tests control when a grandfathered dispatch settles; `mock.calls`
// exposes the request (trigger / topicId / userMessageId) for assertions.
const dispatchResolvers: Array<() => void> = []
const mockDispatchStreamRequest = vi.fn(
  (
    _manager: unknown,
    _subscriber: unknown,
    _req: { topicId: string; trigger?: string; userMessageId?: string }
  ): Promise<unknown> => {
    return new Promise((resolve) => {
      dispatchResolvers.push(() => resolve({ mode: 'started' }))
    })
  }
)

vi.mock('../context/dispatch', () => ({
  dispatchStreamRequest: mockDispatchStreamRequest
}))

// Boot-sweep reconcile reads/writes through MessageService.
const findPendingAssistantMessageIds = vi.fn<() => string[]>(() => [])
const markMessagesError = vi.fn<(ids: string[]) => void>(() => undefined)
vi.mock('@main/data/services/MessageService', () => ({
  messageService: {
    findPendingAssistantMessageIds: () => findPendingAssistantMessageIds(),
    markMessagesError: (ids: string[]) => markMessagesError(ids)
  }
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

// Controllable naming registry — `drainWaitSet` reads `topicNamingService.inFlightWrites()`.
const namingWrites = new Map<string, Promise<void>>()
vi.mock('@main/services/TopicNamingService', () => ({
  topicNamingService: { inFlightWrites: () => namingWrites }
}))

// `startAgentSessionRun`'s quiesce gate must throw BEFORE prepareDispatch writes rows.
const prepareDispatchMock = vi.fn()
vi.mock('../context/AgentChatContextProvider', () => ({
  agentChatContextProvider: { prepareDispatch: prepareDispatchMock }
}))

const { AiStreamManager } = await import('../AiStreamManager')
const { startAgentSessionRun } = await import('../api/startAgentSessionRun')

// ── Helpers ─────────────────────────────────────────────────────────

type ManagerInstance = InstanceType<typeof AiStreamManager>

/** White-box view of the private quiesce/steer state (house idiom, see JobManager.pause.test.ts). */
interface ManagerInternals {
  pauseHolds: Set<symbol>
  suppressedChatContinuationTopicIds: Set<string>
  inFlightChatContinuations: Map<string, Promise<void>>
  pendingSteers: Map<string, string[]>
  activeStreams: Map<string, ActiveStream>
  startNextChatTurn(topicId: string): Promise<void>
}

function internals(mgr: ManagerInstance): ManagerInternals {
  return mgr as unknown as ManagerInternals
}

function createManager(): ManagerInstance {
  BaseService.resetInstances()
  const Ctor = AiStreamManager as unknown as new (config?: Partial<AiStreamManagerConfig>) => ManagerInstance
  return new Ctor()
}

const runOnInit = (mgr: ManagerInstance) => (mgr as unknown as { onInit(): Promise<void> }).onInit()

const fakeSubscriber = {} as StreamListener
const openReq = (topicId: string) => ({ trigger: 'submit-message', topicId, messages: [] }) as never
const steerReq = (topicId: string, userMessageId: string) =>
  ({ trigger: 'steer-continuation', topicId, userMessageId }) as never

function streamListener(id: string): StreamListener {
  return { id, onChunk: vi.fn(), onDone: vi.fn(), onPaused: vi.fn(), onError: vi.fn(), isAlive: () => true }
}

/** Drain pending microtasks + the async-mutex acquire (which resolves on a macrotask). */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function makeDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/** Observe settlement without consuming the promise. */
function trackSettled<T>(promise: Promise<T>): { promise: Promise<T>; isSettled: () => boolean } {
  let settled = false
  const tracked = promise.then(
    (value) => {
      settled = true
      return value
    },
    (error) => {
      settled = true
      throw error
    }
  )
  return { promise: tracked, isSettled: () => settled }
}

/**
 * Seed a fake stream directly into `activeStreams` — the drain suite only needs
 * the fields `drainWaitSet` reads (listener-key prefixes + `loopPromise`), not a
 * real execution loop.
 */
function seedFakeStream(
  mgr: ManagerInstance,
  topicId: string,
  opts: { listenerKey: string; loopPromise: Promise<void> }
): { abortController: AbortController } {
  const abortController = new AbortController()
  const stream = {
    topicId,
    turnId: 'test-turn',
    executions: new Map([
      [
        'provider::model',
        {
          modelId: 'provider::model',
          abortController,
          status: 'streaming',
          buffer: [],
          droppedChunks: 0,
          loopPromise: opts.loopPromise,
          timings: { startedAt: 0 }
        }
      ]
    ]),
    listeners: new Map([[opts.listenerKey, { id: opts.listenerKey }]]),
    status: 'streaming',
    isMultiModel: false,
    lifecycle: {}
  } as unknown as ActiveStream
  internals(mgr).activeStreams.set(topicId, stream)
  return { abortController }
}

// ── Suite ───────────────────────────────────────────────────────────

describe('AiStreamManager pause / drainInFlight (write quiesce)', () => {
  let mgr: ManagerInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    dispatchResolvers.length = 0
    namingWrites.clear()
    findPendingAssistantMessageIds.mockReturnValue([])
    mgr = createManager()
    // `startAgentSessionRun` resolves the manager via the container.
    ;(application.get as ReturnType<typeof vi.fn>).mockImplementation((name: string) => {
      if (name === 'AiStreamManager') return mgr
      throw new Error(`AiStreamManager.pause.test: unexpected application.get('${name}')`)
    })
    // onInit resolves the reconcile gate `dispatch` awaits.
    await runOnInit(mgr)
  })

  afterEach(() => {
    BaseService.resetInstances()
  })

  // -------------------------------------------------------------------------
  // Blocked surface while paused
  // -------------------------------------------------------------------------

  describe('blocked surface while paused', () => {
    it('blocks dispatch — resolves {mode:"blocked", reason:"paused"} without reaching dispatchStreamRequest', async () => {
      mgr.pause('test: restore')

      const res = await mgr.dispatch(fakeSubscriber, openReq('t'))
      expect(res).toMatchObject({ mode: 'blocked', reason: 'paused', message: expect.any(String) })
      expect(mockDispatchStreamRequest).not.toHaveBeenCalled()
    })

    it('re-checks the pause flag under the per-topic lock — a dispatch queued behind a live one is still rejected', async () => {
      // A acquires the lock and parks inside the deferred dispatchStreamRequest; B waits on the mutex.
      const pA = mgr.dispatch(fakeSubscriber, openReq('t'))
      const pB = mgr.dispatch(fakeSubscriber, openReq('t'))
      await flush()
      expect(mockDispatchStreamRequest).toHaveBeenCalledTimes(1)

      // Pause lands while B is parked — the post-mutex re-check must reject it.
      mgr.pause('test: mutex race')
      dispatchResolvers[0]()
      await flush()

      await expect(pA).resolves.toMatchObject({ mode: 'started' })
      await expect(pB).resolves.toMatchObject({ mode: 'blocked', reason: 'paused' })
      expect(mockDispatchStreamRequest).toHaveBeenCalledTimes(1)
    })

    it('exempts steer-continuation dispatches — a grandfathered launch still reaches dispatchStreamRequest', async () => {
      mgr.pause('test: exemption')

      const p = mgr.dispatch(fakeSubscriber, steerReq('t', 'u1'))
      await flush()
      expect(mockDispatchStreamRequest).toHaveBeenCalledTimes(1)
      expect(mockDispatchStreamRequest.mock.calls[0][2]).toMatchObject({ trigger: 'steer-continuation' })

      dispatchResolvers[0]()
      await expect(p).resolves.toMatchObject({ mode: 'started' })
    })

    it('suppresses a paused startNextChatTurn without consuming the queue head', async () => {
      mgr.pause('test: suppression')
      internals(mgr).pendingSteers.set('t', ['u1', 'u2'])

      await internals(mgr).startNextChatTurn('t')

      // Queue intact (the steer stays answerable after release) and the topic recorded as debt.
      expect(internals(mgr).pendingSteers.get('t')).toEqual(['u1', 'u2'])
      expect(internals(mgr).suppressedChatContinuationTopicIds.has('t')).toBe(true)
      expect(mockDispatchStreamRequest).not.toHaveBeenCalled()
    })

    it('rejects a paused startAgentSessionRun before prepareDispatch writes any rows', async () => {
      mgr.pause('test: agent-session gate')

      await expect(
        startAgentSessionRun({ sessionId: 's1', userParts: [], listeners: [streamListener('l1')] })
      ).rejects.toThrow(/write-quiesced/)
      expect(prepareDispatchMock).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // drainInFlight
  // -------------------------------------------------------------------------

  describe('drainInFlight', () => {
    it('returns a clean verdict when nothing is in flight', async () => {
      const hold = mgr.pause('test: clean drain')

      await expect(mgr.drainInFlight({ timeoutMs: 200 })).resolves.toEqual({ stragglerIds: [] })

      hold.dispose()
    })

    it('resolves with a verdict (no throw) when called without an active hold', async () => {
      // Precondition violation is warned, not thrown — the verdict is still usable.
      await expect(mgr.drainInFlight({ timeoutMs: 100 })).resolves.toEqual({ stragglerIds: [] })
    })

    it('waits for a live persistence-bearing stream to settle', async () => {
      const loop = makeDeferred()
      seedFakeStream(mgr, 't', { listenerKey: 'persistence:x', loopPromise: loop.promise })
      const hold = mgr.pause('test: stream drain')

      const drain = trackSettled(mgr.drainInFlight({ timeoutMs: 5000 }))
      await flush()
      expect(drain.isSettled()).toBe(false)

      loop.resolve()
      await expect(drain.promise).resolves.toEqual({ stragglerIds: [] })

      hold.dispose()
    })

    it('excludes prompt streams (no persistence:* listener) from the wait-set', async () => {
      // A never-settling prompt loop (translate / API gateway) must not fake a dirty verdict —
      // with it excluded the drain returns clean immediately, well inside the short timeout.
      const never = makeDeferred()
      seedFakeStream(mgr, 'translate-1', { listenerKey: 'renderer:1', loopPromise: never.promise })
      const hold = mgr.pause('test: prompt excluded')

      await expect(mgr.drainInFlight({ timeoutMs: 50 })).resolves.toEqual({ stragglerIds: [] })

      hold.dispose()
    })

    it('reports stragglers on timeout without aborting or evicting them', async () => {
      const loop = makeDeferred()
      const loopState = trackSettled(loop.promise)
      const { abortController } = seedFakeStream(mgr, 't', {
        listenerKey: 'persistence:x',
        loopPromise: loop.promise
      })
      const hold = mgr.pause('test: straggler')

      const verdict = await mgr.drainInFlight({ timeoutMs: 30 })
      expect(verdict.stragglerIds).toEqual(['t'])

      // Straggler untouched: not aborted, loop still pending, stream not evicted — the restore
      // orchestrator decides its fate.
      await flush()
      expect(abortController.signal.aborted).toBe(false)
      expect(loopState.isSettled()).toBe(false)
      expect(internals(mgr).activeStreams.has('t')).toBe(true)

      hold.dispose()
      loop.resolve()
    })

    it('awaits the detached topic-naming write registry', async () => {
      const write = makeDeferred()
      namingWrites.set('topic:t', write.promise)
      const hold = mgr.pause('test: naming drain')

      const drain = trackSettled(mgr.drainInFlight({ timeoutMs: 5000 }))
      await flush()
      expect(drain.isSettled()).toBe(false)

      write.resolve()
      await expect(drain.promise).resolves.toEqual({ stragglerIds: [] })

      hold.dispose()
    })

    it('drains to a fixed point — a naming write spawned by a settling loop is still awaited', async () => {
      const loop = makeDeferred()
      const naming = makeDeferred()
      seedFakeStream(mgr, 't', { listenerKey: 'persistence:x', loopPromise: loop.promise })
      // Model PersistenceListener's detached spawn: the naming write registers as the loop settles,
      // AFTER the drain took its first snapshot.
      void loop.promise.then(() => {
        namingWrites.set('topic:t', naming.promise)
      })
      const hold = mgr.pause('test: fixed point')

      const drain = trackSettled(mgr.drainInFlight({ timeoutMs: 5000 }))
      await flush()
      expect(drain.isSettled()).toBe(false)

      loop.resolve()
      await flush()
      // First wait-set (the loop) settled, but the re-collect found the naming write.
      expect(drain.isSettled()).toBe(false)

      naming.resolve()
      await expect(drain.promise).resolves.toEqual({ stragglerIds: [] })

      hold.dispose()
    })
  })

  // -------------------------------------------------------------------------
  // Holds & release compensation
  // -------------------------------------------------------------------------

  describe('holds and release compensation', () => {
    it('refcounts holds — quiesced until the last hold is disposed', () => {
      const h1 = mgr.pause('holder-1')
      const h2 = mgr.pause('holder-2')
      expect(mgr.isWriteQuiesced).toBe(true)

      h1.dispose()
      expect(mgr.isWriteQuiesced).toBe(true)

      h2.dispose()
      expect(mgr.isWriteQuiesced).toBe(false)
    })

    it('dispose is idempotent — double-dispose cannot release another hold', () => {
      const h1 = mgr.pause('holder-1')
      const h2 = mgr.pause('holder-2')

      h1.dispose()
      h1.dispose() // must not decrement h2's hold
      expect(mgr.isWriteQuiesced).toBe(true)

      h2.dispose()
      expect(mgr.isWriteQuiesced).toBe(false)
    })

    it('re-kicks a suppressed steer continuation exactly once on last-hold release', async () => {
      const hold = mgr.pause('test: release kick')
      internals(mgr).pendingSteers.set('t', ['u1'])
      await internals(mgr).startNextChatTurn('t') // suppressed under the hold
      expect(internals(mgr).suppressedChatContinuationTopicIds.has('t')).toBe(true)
      expect(mockDispatchStreamRequest).not.toHaveBeenCalled()

      hold.dispose()
      // The launch promise registers SYNCHRONOUSLY (before the microtask body) so a drain started
      // in the same tick sees it.
      expect(internals(mgr).inFlightChatContinuations.has('t')).toBe(true)

      await flush()
      await flush()
      // The compensation kick launched the continuation for the suppressed topic and consumed the head.
      expect(mockDispatchStreamRequest).toHaveBeenCalledTimes(1)
      expect(mockDispatchStreamRequest.mock.calls[0][2]).toMatchObject({
        trigger: 'steer-continuation',
        topicId: 't',
        userMessageId: 'u1'
      })
      expect(internals(mgr).suppressedChatContinuationTopicIds.size).toBe(0)
      expect(internals(mgr).pendingSteers.has('t')).toBe(false)

      // Exactly once — settling the launch spawns no second kick, and the registry empties.
      dispatchResolvers[0]()
      await flush()
      expect(mockDispatchStreamRequest).toHaveBeenCalledTimes(1)
      expect(internals(mgr).inFlightChatContinuations.size).toBe(0)
    })

    it('newer hold inherits the suppressed-continuation debt', async () => {
      const hA = mgr.pause('holder-A')
      internals(mgr).pendingSteers.set('t', ['u1'])
      await internals(mgr).startNextChatTurn('t') // suppressed under A
      const hB = mgr.pause('holder-B')

      hA.dispose()
      await flush()
      await flush()
      // Still quiesced under B: nothing kicked, the debt is intact.
      expect(mockDispatchStreamRequest).not.toHaveBeenCalled()
      expect(internals(mgr).suppressedChatContinuationTopicIds.has('t')).toBe(true)

      hB.dispose()
      await flush()
      await flush()
      expect(mockDispatchStreamRequest).toHaveBeenCalledTimes(1)
      expect(mockDispatchStreamRequest.mock.calls[0][2]).toMatchObject({
        trigger: 'steer-continuation',
        topicId: 't',
        userMessageId: 'u1'
      })

      dispatchResolvers[0]()
      await flush()
    })

    it('fails closed — a dropped (never disposed) hold keeps admission blocked', async () => {
      mgr.pause('test: dropped hold')
      expect(mgr.isWriteQuiesced).toBe(true)

      const res = await mgr.dispatch(fakeSubscriber, openReq('t'))
      expect(res).toMatchObject({ mode: 'blocked', reason: 'paused' })
      expect(mockDispatchStreamRequest).not.toHaveBeenCalled()
    })
  })
})
