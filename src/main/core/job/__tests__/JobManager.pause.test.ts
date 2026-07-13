/**
 * pause() / drainInFlight() write-quiesce contract tests.
 *
 * Contract (issue #16850, final): `pause(reason?): Disposable` blocks all
 * autonomous JobManager writes (dispatch claims, schedule fires, GC /
 * promotion ticks, new startup-recovery steps) while request-driven writes
 * (enqueue / cancel / schedule mutations / triggerNow fallback) stay allowed.
 * `drainInFlight({ timeoutMs })` awaits in-flight handler executions
 * (including onSettled) plus the in-flight deferred startup-recovery flow;
 * clean verdict = empty `stragglerIds` AND `startupRecoveryPending === false`.
 * There is no manager-level resume(): disposing the last hold runs the
 * catch-up compensation pass.
 *
 * Also covers the pre-existing onStop drain gaps fixed alongside (waiting on
 * `finishedResolvers` missed cross-restart jobs and returned before
 * onSettled): see the "onStop drain regression" block.
 */

import { application } from '@application'
import { jobScheduleTable, jobTable } from '@data/db/schemas/job'
import type { DbType } from '@data/db/types'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { jobService } from '@data/services/JobService'
import { JobManager } from '@main/core/job/JobManager'
import type { JobHandle, JobHandler } from '@main/core/job/types'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { SchedulerService } from '@main/core/scheduler/SchedulerService'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainCacheServiceExport } from '@test-mocks/main/CacheService'
import { MockMainDbServiceExport } from '@test-mocks/main/DbService'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { drainTrailingDispatch } from './_helpers'

vi.mock('@application', async () => {
  const mod = await import('@test-mocks/main/application')
  return mod.mockApplicationFactory()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Poll until `predicate` holds; the final expect surfaces a timeout as a failure. */
async function pollUntil(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await sleep(10)
  }
  expect(predicate()).toBe(true)
}

/** Flush the enqueue → dispatch fire-and-forget chain (microtasks + immediates). */
async function flushDispatch(): Promise<void> {
  for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r))
}

function makeGate(): { promise: Promise<void>; release: () => void } {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

/** Handler that completes immediately, counting executions. */
function makeCountingHandler(counter: { count: number }): JobHandler {
  return {
    recovery: 'retry',
    cancelTimeoutMs: 1000,
    defaultConcurrency: 2,
    async execute() {
      counter.count++
      return { ok: true }
    }
  }
}

/**
 * Handler parked on a manually-released gate (NOT a timer — safe under fake
 * timers). Honors abort; `abortDelayMs` delays the abort rejection to model a
 * handler that takes a while to unwind after the signal.
 */
function makeGateHandler(
  counter: { count: number },
  gate: Promise<void>,
  opts: { abortDelayMs?: number; onSettled?: JobHandler['onSettled'] } = {}
): JobHandler {
  return {
    recovery: 'retry',
    cancelTimeoutMs: 1500,
    defaultConcurrency: 2,
    async execute(ctx) {
      counter.count++
      await new Promise<void>((resolve, reject) => {
        const fail = () => {
          if (opts.abortDelayMs) setTimeout(() => reject(new Error('AbortError')), opts.abortDelayMs)
          else reject(new Error('AbortError'))
        }
        if (ctx.signal.aborted) return fail()
        ctx.signal.addEventListener('abort', fail, { once: true })
        void gate.then(() => {
          ctx.signal.removeEventListener('abort', fail)
          resolve()
        })
      })
      return { ok: true }
    },
    onSettled: opts.onSettled
  }
}

interface JobManagerInternals {
  _recoveryDone?: Promise<void>
  finishedResolvers: Map<string, unknown>
  inFlightExecuted: Map<string, Promise<void>>
  queues: Map<string, { mutex: { acquire: () => Promise<() => void> } }>
  suppressedOnceScheduleIds: Set<string>
  scheduleDisposables: Map<string, unknown>
  releaseBarrierHeld: boolean
  finishRelease(): void
}

function internals(jm: JobManager): JobManagerInternals {
  return jm as unknown as JobManagerInternals
}

interface BootstrapOptions {
  /** Registered BEFORE _doInit so startup recovery sees them. */
  handlers?: Array<[string, JobHandler]>
  /**
   * Install fake timers BEFORE _doInit so onReady's registerInterval ticks
   * (GC / delayed promotion, real setInterval) are fake and advanceable.
   */
  fakeIntervalTimers?: boolean
  /** Additionally fake `Date` so croner's calendar advances with the timers. */
  fakeDate?: boolean
  /** Runs after _doAllReady arms the quiet-window timer, before it advances. */
  beforeRecovery?: (jobManager: JobManager) => Promise<void> | void
  /**
   * Skip awaiting `_recoveryDone` — for tests that park the recovery flow on
   * a gate mid-flight (awaiting it would hang the bootstrap).
   */
  awaitRecovery?: boolean
  /** Return with fake timers still installed; the caller must vi.useRealTimers(). */
  keepFakeTimers?: boolean
}

async function bootstrapManager(opts: BootstrapOptions = {}): Promise<{
  scheduler: SchedulerService
  jobManager: JobManager
}> {
  BaseService.resetInstances()
  const scheduler = new SchedulerService()
  const jobManager = new JobManager()

  const dbSvc = MockMainDbServiceExport.dbService
  const cacheSvc = MockMainCacheServiceExport.cacheService
  ;(application.get as ReturnType<typeof vi.fn>).mockImplementation((name: string) => {
    switch (name) {
      case 'DbService':
        return dbSvc
      case 'CacheService':
        return cacheSvc
      case 'SchedulerService':
        return scheduler
      case 'JobManager':
        return jobManager
      case 'PowerService':
        return { preventSleep: () => ({ dispose: () => {} }) }
    }
    throw new Error(`Unexpected application.get('${name}')`)
  })

  for (const [type, h] of opts.handlers ?? []) {
    jobManager.registerHandler(type as never, h)
  }

  const toFake: Array<'setTimeout' | 'clearTimeout' | 'setInterval' | 'clearInterval' | 'Date'> = [
    'setTimeout',
    'clearTimeout'
  ]
  if (opts.fakeIntervalTimers) toFake.push('setInterval', 'clearInterval')
  if (opts.fakeDate) toFake.push('Date')

  // Interval ticks are registered inside onReady with real setInterval — to
  // gate-test them the fake clock must be installed before _doInit.
  if (opts.fakeIntervalTimers || opts.fakeDate) vi.useFakeTimers({ toFake })
  await scheduler._doInit()
  await jobManager._doInit()
  if (!(opts.fakeIntervalTimers || opts.fakeDate)) vi.useFakeTimers({ toFake })

  void jobManager._doAllReady()
  if (opts.beforeRecovery) await opts.beforeRecovery(jobManager)
  await vi.advanceTimersByTimeAsync(60_000)
  if (opts.awaitRecovery !== false) {
    await internals(jobManager)._recoveryDone
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(100)
  } else {
    // Flush microtasks so the flow reaches its first gated await.
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0)
  }
  if (!opts.keepFakeTimers) vi.useRealTimers()
  return { scheduler, jobManager }
}

async function teardownManager(scheduler: SchedulerService, jobManager: JobManager): Promise<void> {
  await jobManager._doStop()
  await scheduler._doStop()
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('JobManager pause / drainInFlight', () => {
  setupTestDatabase()

  beforeAll(() => {
    BaseService.resetInstances()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // -------------------------------------------------------------------------
  // Blocked surface (allow/block matrix)
  // -------------------------------------------------------------------------

  describe('blocked surface while paused', () => {
    it('keeps enqueued jobs pending (no claim); release compensation dispatches them', async () => {
      const counter = { count: 0 }
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['pause.gate1', makeCountingHandler(counter)]]
      })

      const hold = jobManager.pause('test: dispatch gate')
      const handle = jobManager.enqueue('pause.gate1' as never, { message: 'x' } as never)
      expect(handle.snapshot.status).toBe('pending')

      await flushDispatch()
      await sleep(30)
      expect(counter.count).toBe(0)
      expect(jobService.getById(handle.id)?.status).toBe('pending')

      const verdict = await jobManager.drainInFlight({ timeoutMs: 200 })
      expect(verdict).toEqual({ stragglerIds: [], startupRecoveryPending: false })

      hold.dispose()
      const settled = await handle.finished
      expect(settled.status).toBe('completed')
      expect(counter.count).toBe(1)

      await drainTrailingDispatch(jobManager)
      await teardownManager(scheduler, jobManager)
    })

    it('re-checks the pause flag after acquiring the dispatch mutex (claim cannot land after drain)', async () => {
      const counter = { count: 0 }
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['pause.race', makeCountingHandler(counter)]]
      })

      // Prime the queue so its mutex exists.
      const first = jobManager.enqueue('pause.race' as never, { message: 'prime' } as never)
      await first.finished
      await drainTrailingDispatch(jobManager)
      expect(counter.count).toBe(1)

      // Hold the Layer-1 mutex, then let a dispatch pass the entry check and
      // block on it BEFORE pause lands.
      const queue = internals(jobManager).queues.get('pause.race')!
      const releaseMutex = await queue.mutex.acquire()
      const second = jobManager.enqueue('pause.race' as never, { message: 'blocked' } as never)
      await flushDispatch()

      const hold = jobManager.pause('test: mutex race')
      const verdict = await jobManager.drainInFlight({ timeoutMs: 200 })
      expect(verdict.stragglerIds).toEqual([])

      // Mutex frees AFTER drain returned — the resumed dispatch must re-check
      // the pause flag and claim nothing.
      releaseMutex()
      await flushDispatch()
      await sleep(30)
      expect(counter.count).toBe(1)
      expect(jobService.getById(second.id)?.status).toBe('pending')

      hold.dispose()
      const settled = await second.finished
      expect(settled.status).toBe('completed')

      await drainTrailingDispatch(jobManager)
      await teardownManager(scheduler, jobManager)
    })

    it('suppresses interval schedule fires (no enqueue, no markFired); the chain stays armed for release', async () => {
      const counter = { count: 0 }
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['pause.interval', makeCountingHandler(counter)]],
        keepFakeTimers: true
      })

      const { id } = jobManager.registerJobSchedule({
        type: 'pause.interval',
        trigger: { kind: 'interval', ms: 200 },
        jobInputTemplate: { message: 'tick' },
        catchUpPolicy: { kind: 'skip-missed' }
      } as never)

      // Control fire before pausing.
      await vi.advanceTimersByTimeAsync(250)
      expect(jobService.list({ type: 'pause.interval' })).toHaveLength(1)
      const lastRunBefore = jobScheduleService.getById(id)!.lastRun
      expect(lastRunBefore).not.toBeNull()

      const hold = jobManager.pause('test: interval gate')
      await vi.advanceTimersByTimeAsync(450)
      expect(jobService.list({ type: 'pause.interval' })).toHaveLength(1)
      expect(jobScheduleService.getById(id)!.lastRun).toBe(lastRunBefore)

      // Interval chain re-arms in the scheduler wrapper — release needs no
      // compensation, the next natural fire just works.
      hold.dispose()
      await vi.advanceTimersByTimeAsync(250)
      expect(jobService.list({ type: 'pause.interval' })).toHaveLength(2)

      vi.useRealTimers()
      await drainTrailingDispatch(jobManager)
      await teardownManager(scheduler, jobManager)
    })

    it('suppresses once fires, records the id before returning, and refires exactly once on release', async () => {
      const counter = { count: 0 }
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['pause.once', makeCountingHandler(counter)]],
        keepFakeTimers: true
      })

      const at = Date.now() + 200
      const { id } = jobManager.registerJobSchedule({
        type: 'pause.once',
        trigger: { kind: 'once', at },
        jobInputTemplate: { message: 'one-shot' },
        catchUpPolicy: { kind: 'skip-missed' }
      } as never)

      const hold = jobManager.pause('test: once suppression')
      await vi.advanceTimersByTimeAsync(300)

      // The gated branch records the schedule id BEFORE returning and writes
      // nothing: no job row, no markFired.
      expect(internals(jobManager).suppressedOnceScheduleIds.has(id)).toBe(true)
      expect(jobService.list({ type: 'pause.once' })).toHaveLength(0)
      expect(jobScheduleService.getById(id)!.lastRun).toBeNull()

      vi.useRealTimers()
      await sleep(250) // let the wall clock pass `at` so the re-armed timer fires immediately

      hold.dispose()
      await pollUntil(() => jobService.list({ type: 'pause.once' }).length === 1)
      await pollUntil(() => jobService.list({ type: 'pause.once' })[0].status === 'completed')
      expect(internals(jobManager).suppressedOnceScheduleIds.size).toBe(0)
      const fired = jobScheduleService.getById(id)!
      expect(fired.lastRun).not.toBeNull()
      expect(Date.parse(fired.lastRun!)).toBeGreaterThanOrEqual(at)

      // Exactly once — no duplicate make-up fire.
      await sleep(150)
      expect(jobService.list({ type: 'pause.once' })).toHaveLength(1)

      await drainTrailingDispatch(jobManager)
      await teardownManager(scheduler, jobManager)
    })

    it('gates GC and delayed-promotion ticks while paused (control: they run after release)', async () => {
      const { scheduler, jobManager } = await bootstrapManager({
        fakeIntervalTimers: true,
        keepFakeTimers: true
      })

      const gcSpy = vi.spyOn(jobService, 'pruneTerminalOlderThan')
      const promoteSpy = vi.spyOn(jobService, 'promoteDelayedDue')

      const hold = jobManager.pause('test: tick gate')
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000) // 1× GC tick + 12× promotion ticks, all gated
      expect(gcSpy).not.toHaveBeenCalled()
      expect(promoteSpy).not.toHaveBeenCalled()

      // Release compensation runs one promotion pass itself (step 1).
      hold.dispose()
      expect(promoteSpy).toHaveBeenCalledTimes(1)

      gcSpy.mockClear()
      promoteSpy.mockClear()
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
      expect(gcSpy).toHaveBeenCalled()
      expect(promoteSpy).toHaveBeenCalled()

      gcSpy.mockRestore()
      promoteSpy.mockRestore()
      vi.useRealTimers()
      await teardownManager(scheduler, jobManager)
    })

    it('skips promoteDueAtFire while paused; release promotes the delayed row', async () => {
      const counter = { count: 0 }
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['pause.delayed', makeCountingHandler(counter)]],
        keepFakeTimers: true
      })

      const promoteSpy = vi.spyOn(jobService, 'promoteDelayedDue')

      const hold = jobManager.pause('test: promoteDueAtFire gate')
      const handle = jobManager.enqueue(
        'pause.delayed' as never,
        { message: 'later' } as never,
        { scheduledAt: Date.now() + 50 } as never
      )
      expect(handle.snapshot.status).toBe('delayed')

      // The once promotion timer fires inside the pause window → gated before
      // any promotion write.
      await vi.advanceTimersByTimeAsync(100)
      expect(promoteSpy).not.toHaveBeenCalled()
      expect(jobService.getById(handle.id)?.status).toBe('delayed')

      vi.useRealTimers()
      await sleep(60) // wall clock passes scheduledAt so release's promotion pass catches it
      hold.dispose()

      const settled = await handle.finished
      expect(settled.status).toBe('completed')
      expect(counter.count).toBe(1)

      promoteSpy.mockRestore()
      await drainTrailingDispatch(jobManager)
      await teardownManager(scheduler, jobManager)
    })
  })

  // -------------------------------------------------------------------------
  // Allowed surface (request-driven writes keep working)
  // -------------------------------------------------------------------------

  describe('allowed surface while paused', () => {
    it('enqueueTx lands the row pending after commit without dispatching', async () => {
      const counter = { count: 0 }
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['pause.tx', makeCountingHandler(counter)]]
      })
      const db = MockMainDbServiceExport.dbService.getDb() as DbType

      const hold = jobManager.pause('test: enqueueTx')
      let handle!: JobHandle
      db.transaction(
        (tx) => {
          handle = jobManager.enqueueTx(tx, 'pause.tx' as never, { message: 'atomic' } as never)
        },
        { behavior: 'immediate' }
      )

      await flushDispatch()
      await sleep(30)
      expect(counter.count).toBe(0)
      expect(jobService.getById(handle.id)?.status).toBe('pending')

      hold.dispose()
      const settled = await handle.finished
      expect(settled.status).toBe('completed')

      await drainTrailingDispatch(jobManager)
      await teardownManager(scheduler, jobManager)
    })

    it('cancel finalizes a pending row while paused', async () => {
      const counter = { count: 0 }
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['pause.cancel1', makeCountingHandler(counter)]]
      })

      const hold = jobManager.pause('test: pending cancel')
      const handle = jobManager.enqueue('pause.cancel1' as never, { message: 'doomed' } as never)
      await flushDispatch()

      const result = await jobManager.cancel(handle.id, 'user asked')
      expect(result.outcome).toBe('cancelled')
      expect(jobService.getById(handle.id)?.status).toBe('cancelled')

      hold.dispose()
      await drainTrailingDispatch(jobManager)
      await teardownManager(scheduler, jobManager)
    })

    it('cancel aborts an in-flight job and its settlement write lands during the pause window', async () => {
      const counter = { count: 0 }
      const gate = makeGate()
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['pause.cancel2', makeGateHandler(counter, gate.promise)]]
      })

      const handle = jobManager.enqueue('pause.cancel2' as never, { message: 'inflight' } as never)
      await pollUntil(() => jobService.getById(handle.id)?.status === 'running')

      const hold = jobManager.pause('test: in-flight cancel')
      const result = await jobManager.cancel(handle.id, 'user asked')
      expect(result.outcome).toBe('cancelled')
      expect(jobService.getById(handle.id)?.status).toBe('cancelled')

      const verdict = await jobManager.drainInFlight({ timeoutMs: 500 })
      expect(verdict).toEqual({ stragglerIds: [], startupRecoveryPending: false })

      hold.dispose()
      await drainTrailingDispatch(jobManager)
      await teardownManager(scheduler, jobManager)
    })

    it('triggerJobScheduleNowById skips scheduler.triggerNow and falls back to enqueue + markFired', async () => {
      const counter = { count: 0 }
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['pause.trigger', makeCountingHandler(counter)]]
      })

      const { id } = jobManager.registerJobSchedule({
        type: 'pause.trigger',
        trigger: { kind: 'cron', expr: '0 * * * *' },
        jobInputTemplate: { message: 'manual' },
        catchUpPolicy: { kind: 'skip-missed' }
      } as never)

      const triggerNowSpy = vi.spyOn(scheduler, 'triggerNow')
      const hold = jobManager.pause('test: triggerNow fallback')

      const ok = await jobManager.triggerJobScheduleNowById(id)
      expect(ok).toBe(true)
      // The cron IS armed — an unforced path would call scheduler.triggerNow,
      // return true, and enqueue nothing (suppressed cron fire = silent loss).
      expect(triggerNowSpy).not.toHaveBeenCalled()

      const rows = jobService.list({ type: 'pause.trigger' })
      expect(rows).toHaveLength(1)
      expect(rows[0].status).toBe('pending')
      expect(rows[0].scheduleId).toBe(id)
      expect(jobScheduleService.getById(id)!.lastRun).not.toBeNull()

      triggerNowSpy.mockRestore()
      hold.dispose()
      await pollUntil(() => jobService.list({ type: 'pause.trigger' })[0].status === 'completed')

      await drainTrailingDispatch(jobManager)
      await teardownManager(scheduler, jobManager)
    })
  })

  // -------------------------------------------------------------------------
  // drainInFlight
  // -------------------------------------------------------------------------

  describe('drainInFlight', () => {
    it('returns a clean verdict when nothing is in flight', async () => {
      const { scheduler, jobManager } = await bootstrapManager()

      const hold = jobManager.pause('test: clean drain')
      const verdict = await jobManager.drainInFlight({ timeoutMs: 200 })
      expect(verdict).toEqual({ stragglerIds: [], startupRecoveryPending: false })

      hold.dispose()
      await teardownManager(scheduler, jobManager)
    })

    it('returns straggler ids on timeout without rejecting — and does NOT abort them', async () => {
      const counter = { count: 0 }
      const gate = makeGate()
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['pause.straggler', makeGateHandler(counter, gate.promise)]]
      })

      const handle = jobManager.enqueue('pause.straggler' as never, { message: 'slow' } as never)
      await pollUntil(() => jobService.getById(handle.id)?.status === 'running')

      const hold = jobManager.pause('test: straggler')
      const verdict = await jobManager.drainInFlight({ timeoutMs: 100 })
      expect(verdict.stragglerIds).toEqual([handle.id])
      expect(verdict.startupRecoveryPending).toBe(false)

      // Straggler was not aborted: releasing the gate completes it normally.
      gate.release()
      const settled = await handle.finished
      expect(settled.status).toBe('completed')

      hold.dispose()
      await drainTrailingDispatch(jobManager)
      await teardownManager(scheduler, jobManager)
    })

    it('waits for onSettled before returning — settlement writes land before the verdict', async () => {
      const counter = { count: 0 }
      const gate = makeGate()
      let breakerScheduleId = ''
      let settledDone = false
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [
          [
            'pause.settle',
            makeGateHandler(counter, gate.promise, {
              onSettled: async () => {
                // Model the agent.task breaker: a schedule write inside onSettled.
                await sleep(50)
                await application.get('JobManager').pauseJobScheduleById(breakerScheduleId)
                settledDone = true
              }
            })
          ]
        ]
      })

      const { id } = jobManager.registerJobSchedule({
        type: 'pause.settle',
        trigger: { kind: 'interval', ms: 3_600_000 },
        jobInputTemplate: { message: 'breaker' },
        catchUpPolicy: { kind: 'skip-missed' }
      } as never)
      breakerScheduleId = id

      const handle = jobManager.enqueue('pause.settle' as never, { message: 'x' } as never)
      await pollUntil(() => jobService.getById(handle.id)?.status === 'running')

      const hold = jobManager.pause('test: onSettled drain')
      const drainP = jobManager.drainInFlight({ timeoutMs: 3000 })
      await sleep(30)
      gate.release()

      const verdict = await drainP
      expect(verdict).toEqual({ stragglerIds: [], startupRecoveryPending: false })
      // drain returned only after onSettled finished — the breaker write is durable.
      expect(settledDone).toBe(true)
      expect(jobScheduleService.getById(id)!.enabled).toBe(false)

      hold.dispose()
      await drainTrailingDispatch(jobManager)
      await teardownManager(scheduler, jobManager)
    })

    it('waits for cross-restart dispatched jobs that never built a finished resolver', async () => {
      const dbh = MockMainDbServiceExport.dbService.getDb() as DbType
      const now = Date.now()
      const [inserted] = await dbh
        .insert(jobTable)
        .values({
          type: 'pause.xrestart',
          status: 'running',
          queue: 'pause.xrestart',
          scheduledAt: now - 1000,
          startedAt: now - 800,
          attempt: 0,
          maxAttempts: 2,
          input: { message: 'previous-run' },
          cancelRequested: false,
          metadata: {}
        })
        .returning()

      const counter = { count: 0 }
      const gate = makeGate()
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['pause.xrestart', makeGateHandler(counter, gate.promise)]]
      })

      // Recovery reset the row and re-dispatched it — without ever creating a
      // finishedResolvers entry.
      await pollUntil(() => internals(jobManager).inFlightExecuted.has(inserted.id))
      expect(internals(jobManager).finishedResolvers.has(inserted.id)).toBe(false)

      const hold = jobManager.pause('test: cross-restart drain')
      const drainP = jobManager.drainInFlight({ timeoutMs: 3000 })
      await sleep(30)
      gate.release()

      const verdict = await drainP
      expect(verdict).toEqual({ stragglerIds: [], startupRecoveryPending: false })
      expect(jobService.getById(inserted.id)?.status).toBe('completed')

      hold.dispose()
      await drainTrailingDispatch(jobManager)
      await teardownManager(scheduler, jobManager)
    })

    it('resolves with a verdict (no throw) when called without an active hold', async () => {
      const { scheduler, jobManager } = await bootstrapManager()

      const verdict = await jobManager.drainInFlight({ timeoutMs: 100 })
      expect(verdict).toEqual({ stragglerIds: [], startupRecoveryPending: false })

      await teardownManager(scheduler, jobManager)
    })
  })

  // -------------------------------------------------------------------------
  // Startup recovery under pause
  // -------------------------------------------------------------------------

  /** Insert an overdue cron schedule row (nextRun in the past). */
  async function insertOverdueSchedule(
    type: string,
    name: string,
    catchUp: { kind: 'skip-missed' } | { kind: 'after-startup'; minutes: number }
  ): Promise<string> {
    const dbh = MockMainDbServiceExport.dbService.getDb() as DbType
    const now = Date.now()
    const [row] = await dbh
      .insert(jobScheduleTable)
      .values({
        type,
        name,
        trigger: { kind: 'cron', expr: '0 * * * *' },
        jobInputTemplate: { message: `overdue-${name}` },
        enabled: true,
        lastRun: now - 7_200_000,
        nextRun: now - 3_600_000,
        catchUpPolicy: catchUp,
        metadata: {}
      })
      .returning()
    return row.id
  }

  describe('startup recovery under pause', () => {
    it('reports startupRecoveryPending=true when drain times out inside an unfinished onMissed', async () => {
      await insertOverdueSchedule('pause.recov1', 's1', { kind: 'after-startup', minutes: 0 })

      const counter = { count: 0 }
      const missGate = makeGate()
      let missCount = 0
      const handler = makeCountingHandler(counter)
      handler.onMissed = async () => {
        missCount++
        await missGate.promise
      }

      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['pause.recov1', handler]],
        awaitRecovery: false
      })
      expect(missCount).toBe(1) // flow is parked inside onMissed

      const hold = jobManager.pause('test: recovery pending')
      const verdict = await jobManager.drainInFlight({ timeoutMs: 100 })
      // No fake job ids — recovery pending is its own verdict field.
      expect(verdict.stragglerIds).toEqual([])
      expect(verdict.startupRecoveryPending).toBe(true)

      // Release the hold FIRST (replay flag not set — the flow is blocked
      // in-step, so release must NOT start a second flow)…
      hold.dispose()
      // …then the parked step resumes and the flow finishes itself, exactly once.
      missGate.release()
      await internals(jobManager)._recoveryDone
      await pollUntil(() => {
        const rows = jobService.list({ type: 'pause.recov1' })
        return rows.length === 1 && rows[0].status === 'completed'
      })
      expect(missCount).toBe(1)

      await drainTrailingDispatch(jobManager)
      await teardownManager(scheduler, jobManager)
    })

    it('atomic step: the catch-up enqueue lands before the drain verdict; boundary short-circuit reports pending=false and release replays without duplicating it', async () => {
      const scheduleId = await insertOverdueSchedule('pause.recov2', 's1', { kind: 'after-startup', minutes: 0 })

      const counter = { count: 0 }
      const missGate = makeGate()
      let missCount = 0
      const handler = makeCountingHandler(counter)
      handler.onMissed = async () => {
        missCount++
        await missGate.promise
      }

      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['pause.recov2', handler]],
        awaitRecovery: false
      })

      const hold = jobManager.pause('test: atomic step')
      const drainP = jobManager.drainInFlight({ timeoutMs: 3000 })
      await sleep(30)
      // Pause landed inside `await onMissed` — the step must still finish its
      // catch-up enqueue, and that write must land before drain returns.
      missGate.release()

      const verdict = await drainP
      expect(verdict.startupRecoveryPending).toBe(false)
      expect(verdict.stragglerIds).toEqual([])
      const rows = jobService.list({ type: 'pause.recov2' })
      expect(rows).toHaveLength(1)
      expect(rows[0].status).toBe('pending') // enqueued but not dispatched
      expect(rows[0].scheduleId).toBe(scheduleId)

      // Release replays the remaining steps (arm + dispatch) — the already-run
      // catch-up step must NOT re-enqueue.
      hold.dispose()
      await internals(jobManager)._recoveryDone
      await pollUntil(() => jobService.list({ type: 'pause.recov2' })[0].status === 'completed')
      expect(jobService.list({ type: 'pause.recov2' })).toHaveLength(1)
      expect(missCount).toBe(1)

      await drainTrailingDispatch(jobManager)
      await teardownManager(scheduler, jobManager)
    })

    it('runs each schedule step exactly once when release happens while the flow is blocked in-step', async () => {
      await insertOverdueSchedule('pause.recov3', 's1', { kind: 'after-startup', minutes: 0 })
      await insertOverdueSchedule('pause.recov3', 's2', { kind: 'after-startup', minutes: 0 })

      const counter = { count: 0 }
      const missGate = makeGate()
      const missCounts = new Map<string, number>()
      let firstMiss = true
      const handler = makeCountingHandler(counter)
      handler.onMissed = async (event) => {
        missCounts.set(event.scheduleId, (missCounts.get(event.scheduleId) ?? 0) + 1)
        if (firstMiss) {
          firstMiss = false
          await missGate.promise
        }
      }

      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['pause.recov3', handler]],
        awaitRecovery: false
      })
      expect(missCounts.size).toBe(1) // blocked inside the first schedule's step

      const hold = jobManager.pause('test: single-flight')
      const verdict = await jobManager.drainInFlight({ timeoutMs: 100 })
      expect(verdict.startupRecoveryPending).toBe(true)

      // Release with the replay flag NOT set → no second flow. The parked flow
      // resumes at the next boundary, sees pause cleared, and finishes alone.
      hold.dispose()
      missGate.release()
      await internals(jobManager)._recoveryDone

      await pollUntil(() => jobService.list({ type: 'pause.recov3' }).length === 2)
      await pollUntil(() => jobService.list({ type: 'pause.recov3' }).every((r) => r.status === 'completed'))
      // Exactly one onMissed and one catch-up enqueue per schedule.
      expect([...missCounts.values()]).toEqual([1, 1])
      expect(jobService.list({ type: 'pause.recov3' })).toHaveLength(2)

      await drainTrailingDispatch(jobManager)
      await teardownManager(scheduler, jobManager)
    })

    it('defers release kicks while the recovery flow is blocked inside a step', async () => {
      await insertOverdueSchedule('pause.blockflow', 's1', { kind: 'skip-missed' })

      const counter = { count: 0 }
      const missGate = makeGate()
      let missCount = 0
      const handler = makeCountingHandler(counter)
      handler.onMissed = async () => {
        missCount++
        await missGate.promise
      }

      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['pause.blockflow', handler]],
        awaitRecovery: false
      })
      expect(missCount).toBe(1) // flow parked inside the first schedule's onMissed

      const hold = jobManager.pause('test: kicks deferral')

      // A once fire lands inside the pause window: suppressed + recorded, its
      // timer self-cleaned. The release re-arm must wait for the flow.
      const { id: onceId } = jobManager.registerJobSchedule({
        type: 'pause.blockflow',
        trigger: { kind: 'once', at: Date.now() + 100 },
        jobInputTemplate: { message: 'suppressed-once' },
        catchUpPolicy: { kind: 'skip-missed' }
      } as never)
      await sleep(200)
      expect(internals(jobManager).suppressedOnceScheduleIds.has(onceId)).toBe(true)
      expect(scheduler.has(`schedule:${onceId}`)).toBe(false)

      // A job enqueued during the window: must stay unclaimed until the flow
      // completes (release must not hand it to dispatch early).
      const job = jobManager.enqueue('pause.blockflow' as never, { message: 'parked' } as never)

      hold.dispose()
      // dispatch claims only after `await mutex.acquire()` — flush before
      // asserting, or a not-yet-run claim would fake a green.
      await flushDispatch()
      await sleep(50)

      // The flow is still parked inside onMissed: no kick may have run.
      expect(scheduler.has(`schedule:${onceId}`)).toBe(false)
      expect(counter.count).toBe(0)
      expect(jobService.getById(job.id)?.status).toBe('pending')

      missGate.release()
      await internals(jobManager)._recoveryDone
      const settled = await job.finished
      expect(settled.status).toBe('completed')
      // The suppressed once was re-armed by the deferred kicks and fired.
      await pollUntil(() => jobService.list({ type: 'pause.blockflow' }).some((r) => r.scheduleId === onceId))
      expect(missCount).toBe(1)

      await drainTrailingDispatch(jobManager)
      await teardownManager(scheduler, jobManager)
    })

    it('holds the release barrier: no autonomous interval fire before the blocked flow completes', async () => {
      // S1 (type A): overdue cron whose gated onMissed parks the flow.
      await insertOverdueSchedule('pause.barrier.a', 's1', { kind: 'skip-missed' })
      // S2 (type B): overdue interval eligible for a catch-up make-up job.
      const dbh = MockMainDbServiceExport.dbService.getDb() as DbType
      const now = Date.now()
      const [s2] = await dbh
        .insert(jobScheduleTable)
        .values({
          type: 'pause.barrier.b',
          trigger: { kind: 'interval', ms: 200 },
          jobInputTemplate: { message: 'overdue-interval' },
          enabled: true,
          lastRun: now - 3_600_000,
          nextRun: null,
          catchUpPolicy: { kind: 'after-startup', minutes: 0 },
          metadata: {},
          // listEnabled orders by createdAt: pin S2 strictly after S1 so the
          // flow parks on S1's onMissed BEFORE starting S2's catch-up step
          // (same-millisecond inserts tie and the order becomes undefined).
          // Only ordering depends on this — interval overdue detection
          // anchors on lastRun, not createdAt.
          createdAt: now + 1000
        })
        .returning()

      const counterA = { count: 0 }
      const missGate = makeGate()
      let missCount = 0
      const handlerA = makeCountingHandler(counterA)
      handlerA.onMissed = async () => {
        missCount++
        await missGate.promise
      }
      const counterB = { count: 0 }

      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [
          ['pause.barrier.a', handlerA],
          ['pause.barrier.b', makeCountingHandler(counterB)]
        ],
        awaitRecovery: false
      })
      expect(missCount).toBe(1) // flow parked on S1…
      expect(jobService.list({ type: 'pause.barrier.b' })).toHaveLength(0) // …with S2's step not started

      const hold = jobManager.pause('test: release barrier')
      // A mutation re-arms the overdue interval mid-window (allowed surface):
      // its chained timer starts ticking with fires gated.
      jobManager.updateJobSchedule(s2.id, { enabled: true })
      expect(scheduler.has(`schedule:${s2.id}`)).toBe(true)

      hold.dispose()
      // Sleep past several interval periods. Without the release barrier the
      // chained timer fires as soon as the holds are gone and enqueues a
      // natural job — which the parked flow later doubles with its
      // stale-snapshot make-up enqueue.
      await sleep(500)
      expect(jobService.list({ type: 'pause.barrier.b' })).toHaveLength(0)

      missGate.release()
      await internals(jobManager)._recoveryDone
      await pollUntil(() => jobService.list({ type: 'pause.barrier.b' }).length >= 1)

      await drainTrailingDispatch(jobManager)
      await teardownManager(scheduler, jobManager)
    })

    it('defers recovery when paused during the quiet window; release replays the full flow', async () => {
      const scheduleId = await insertOverdueSchedule('pause.recov4', 's1', { kind: 'after-startup', minutes: 0 })

      const counter = { count: 0 }
      let missCount = 0
      const handler = makeCountingHandler(counter)
      handler.onMissed = async () => {
        missCount++
      }

      let hold!: { dispose: () => void }
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['pause.recov4', handler]],
        beforeRecovery: (jm) => {
          hold = jm.pause('test: quiet-window pause')
        }
      })

      // The 60 s timer fired while paused → the flow never started.
      expect(internals(jobManager)._recoveryDone).toBeUndefined()
      expect(jobService.list({ type: 'pause.recov4' })).toHaveLength(0)
      expect(missCount).toBe(0)

      // Not in flight → the deferred flow is release's debt, not drain's.
      const verdict = await jobManager.drainInFlight({ timeoutMs: 100 })
      expect(verdict).toEqual({ stragglerIds: [], startupRecoveryPending: false })

      hold.dispose()
      expect(internals(jobManager)._recoveryDone).toBeDefined()
      await internals(jobManager)._recoveryDone
      await pollUntil(() => {
        const rows = jobService.list({ type: 'pause.recov4' })
        return rows.length === 1 && rows[0].status === 'completed'
      })
      expect(missCount).toBe(1)
      expect(jobService.list({ type: 'pause.recov4' })[0].scheduleId).toBe(scheduleId)
      expect(internals(jobManager).scheduleDisposables.has(scheduleId)).toBe(true) // arm step ran too

      await drainTrailingDispatch(jobManager)
      await teardownManager(scheduler, jobManager)
    })

    it('onStop joins the release replay chain', async () => {
      await insertOverdueSchedule('pause.recov5', 's1', { kind: 'skip-missed' })
      await insertOverdueSchedule('pause.recov5', 's2', { kind: 'skip-missed' })

      const unhandled: unknown[] = []
      const listener = (reason: unknown) => unhandled.push(reason)
      process.on('unhandledRejection', listener)

      const counter = { count: 0 }
      const gateA = makeGate()
      const gateB = makeGate()
      let missIndex = 0
      const handler = makeCountingHandler(counter)
      handler.onMissed = async () => {
        const i = missIndex++
        if (i === 0) await gateA.promise
        else await gateB.promise
      }

      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['pause.recov5', handler]],
        awaitRecovery: false
      })

      const hold = jobManager.pause('test: onStop joins replay')
      // Finish the first step under pause → the flow short-circuits at the next
      // boundary, setting the replay flag.
      gateA.release()
      await internals(jobManager)._recoveryDone
      expect(missIndex).toBe(1)

      // Release starts the replay, which parks inside the second onMissed.
      hold.dispose()
      await pollUntil(() => missIndex === 2)

      const stopP = jobManager._doStop()
      const raced = await Promise.race([stopP.then(() => 'stopped' as const), sleep(50).then(() => 'pending' as const)])
      expect(raced).toBe('pending') // onStop is joined to the replay chain

      gateB.release()
      await stopP
      expect(unhandled).toHaveLength(0)

      process.off('unhandledRejection', listener)
      await scheduler._doStop()
    })
  })

  // -------------------------------------------------------------------------
  // Holds & release compensation
  // -------------------------------------------------------------------------

  describe('holds and release compensation', () => {
    it('refcounts holds; dispose is idempotent; only the last release compensates', async () => {
      const counter = { count: 0 }
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['pause.refcount', makeCountingHandler(counter)]]
      })

      const h1 = jobManager.pause('holder-1')
      const h2 = jobManager.pause('holder-2')

      const handle = jobManager.enqueue('pause.refcount' as never, { message: 'x' } as never)
      await flushDispatch()
      await sleep(20)
      expect(jobService.getById(handle.id)?.status).toBe('pending')

      h1.dispose()
      h1.dispose() // idempotent — must not double-release
      await flushDispatch()
      await sleep(20)
      expect(jobService.getById(handle.id)?.status).toBe('pending')
      expect(counter.count).toBe(0)

      h2.dispose()
      const settled = await handle.finished
      expect(settled.status).toBe('completed')

      await drainTrailingDispatch(jobManager)
      await teardownManager(scheduler, jobManager)
    })

    it('skips post-release kicks while the release barrier is held; finishRelease inherits the debt', async () => {
      const counter = { count: 0 }
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['pause.barrier-window', makeCountingHandler(counter)]],
        keepFakeTimers: true
      })

      const at = Date.now() + 200
      const { id } = jobManager.registerJobSchedule({
        type: 'pause.barrier-window',
        trigger: { kind: 'once', at },
        jobInputTemplate: { message: 'one-shot' },
        catchUpPolicy: { kind: 'skip-missed' }
      } as never)

      // Record debt: the once fire lands suppressed under the hold.
      const hold = jobManager.pause('test: barrier window')
      await vi.advanceTimersByTimeAsync(300)
      expect(internals(jobManager).suppressedOnceScheduleIds.has(id)).toBe(true)

      vi.useRealTimers()
      await sleep(250) // wall clock passes `at` so the re-armed timer fires immediately

      // The single-microtask window of an async release: the recovery chain has
      // settled (no replay cursor, no flow in flight) but the chained
      // `finishRelease` has not dropped the barrier yet. A hold disposed inside
      // that window takes the inline-kicks branch of runReleaseCompensation —
      // the kicks must skip WITHOUT draining the debt (as under a newer pause).
      const promoteSpy = vi.spyOn(jobService, 'promoteDelayedDue')
      internals(jobManager).releaseBarrierHeld = true
      hold.dispose()
      expect(promoteSpy).not.toHaveBeenCalled()
      expect(internals(jobManager).suppressedOnceScheduleIds.has(id)).toBe(true)

      // The chained tail drops the barrier and settles the inherited debt.
      internals(jobManager).finishRelease()
      expect(promoteSpy).toHaveBeenCalledTimes(1)
      expect(internals(jobManager).suppressedOnceScheduleIds.size).toBe(0)
      await pollUntil(() => jobService.list({ type: 'pause.barrier-window' }).length === 1)
      await pollUntil(() => jobService.list({ type: 'pause.barrier-window' })[0].status === 'completed')

      promoteSpy.mockRestore()
      await drainTrailingDispatch(jobManager)
      await teardownManager(scheduler, jobManager)
    })

    it('settles recovery debt before dispatching — stale rows cannot bypass their recovery strategy', async () => {
      const dbh = MockMainDbServiceExport.dbService.getDb() as DbType
      const t0 = Date.now() - 5000
      const [staleRow] = await dbh
        .insert(jobTable)
        .values({
          type: 'pause.debt',
          status: 'pending',
          queue: 'pause.debt',
          scheduledAt: t0,
          attempt: 0,
          maxAttempts: 1,
          input: { message: 'previous-run' },
          cancelRequested: false,
          metadata: {},
          createdAt: t0
        })
        .returning()

      const counter = { count: 0 }
      const handler = makeCountingHandler(counter)
      handler.recovery = 'singleton'
      let hold!: { dispose: () => void }
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['pause.debt', handler]],
        beforeRecovery: (jm) => {
          hold = jm.pause('test: release ordering')
        }
      })
      // The quiet-window pause deferred the whole recovery flow.
      expect(internals(jobManager)._recoveryDone).toBeUndefined()

      // Enqueue during the window: the row lands pending and — crucially —
      // ensures the queue exists in memory, so a dispatch kicked BEFORE the
      // replayed recovery could claim the stale row (a claimed row is
      // excluded from the sweep as in-flight — the strategy bypass would be
      // irreversible).
      const fresh = jobManager.enqueue('pause.debt' as never, { message: 'during-pause' } as never)

      // Order probes: the replayed recovery (getStaleActive is called only by
      // its orphan pass) must run BEFORE the release kicks (promoteDelayedDue
      // is their first call). The claim-side race is microtask-timing
      // dependent, so the ordering itself is the deterministic contract:
      // promote → dispatchAll follow it synchronously, hence
      // "sweep before promote" ⇒ no claim can precede the sweep.
      const order: string[] = []
      const promoteReal = jobService.promoteDelayedDue.bind(jobService)
      const promoteSpy = vi.spyOn(jobService, 'promoteDelayedDue').mockImplementation((now) => {
        order.push('kicks:promote')
        return promoteReal(now)
      })
      const staleActiveReal = jobService.getStaleActive.bind(jobService)
      const sweepSpy = vi.spyOn(jobService, 'getStaleActive').mockImplementation(() => {
        order.push('recovery:sweep')
        return staleActiveReal()
      })

      hold.dispose()
      await internals(jobManager)._recoveryDone
      const settled = await fresh.finished
      expect(settled.status).toBe('completed')
      await drainTrailingDispatch(jobManager)
      promoteSpy.mockRestore()
      sweepSpy.mockRestore()

      expect(order.indexOf('recovery:sweep')).toBeGreaterThanOrEqual(0)
      expect(order.indexOf('kicks:promote')).toBeGreaterThanOrEqual(0)
      expect(order.indexOf('recovery:sweep')).toBeLessThan(order.indexOf('kicks:promote'))

      // Singleton recovery keeps the newest non-terminal row (the fresh one)
      // and must have cancelled the stale one BEFORE any dispatch resumed.
      expect(jobService.getById(staleRow.id)?.status).toBe('cancelled')
      expect(counter.count).toBe(1)

      await teardownManager(scheduler, jobManager)
    })

    it('re-arms a suppressed delayed-promotion fire on release when the row is not yet due', async () => {
      const counter = { count: 0 }
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['pause.skew', makeCountingHandler(counter)]],
        keepFakeTimers: true
      })

      const hold = jobManager.pause('test: suppressed promotion re-arm')
      const handle = jobManager.enqueue(
        'pause.skew' as never,
        { message: 'not-yet-due' } as never,
        { scheduledAt: Date.now() + 600 } as never
      )
      expect(handle.snapshot.status).toBe('delayed')

      // The promotion once-timer elapses on the FAKE clock while the wall
      // clock barely moves: the suppressed fire lands strictly BEFORE the
      // row's wall-clock scheduledAt, and scheduleOnce already self-cleaned
      // the timer.
      await vi.advanceTimersByTimeAsync(700)
      expect(jobService.getById(handle.id)?.status).toBe('delayed')

      vi.useRealTimers()
      // Release while the row is still not due: promoteDelayedDue(now) alone
      // cannot promote it, and without a re-armed timer it would strand in
      // `delayed` until the 5-minute promotion tick (never armed in tests).
      hold.dispose()

      await pollUntil(() => jobService.getById(handle.id)?.status === 'completed')
      expect(counter.count).toBe(1)

      await drainTrailingDispatch(jobManager)
      await teardownManager(scheduler, jobManager)
    })

    it('does not replay historical completed once schedules on release', async () => {
      const dbh = MockMainDbServiceExport.dbService.getDb() as DbType
      const now = Date.now()
      const [spent] = await dbh
        .insert(jobScheduleTable)
        .values({
          type: 'pause.spent',
          trigger: { kind: 'once', at: now - 60_000 },
          jobInputTemplate: { message: 'already-fired' },
          enabled: true, // markFired does not flip enabled — fired state lives in lastRun only
          lastRun: now - 60_000,
          nextRun: null,
          catchUpPolicy: { kind: 'skip-missed' },
          metadata: {}
        })
        .returning()

      const counter = { count: 0 }
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['pause.spent', makeCountingHandler(counter)]]
      })
      expect(internals(jobManager).scheduleDisposables.has(spent.id)).toBe(false)

      const hold = jobManager.pause('test: spent once')
      hold.dispose()
      await sleep(100)

      // A naive "enabled ∧ missing scheduler entry" rebuild would replay this
      // one-shot; the suppressed-once set is the only rebuild source.
      expect(jobService.list({ type: 'pause.spent' })).toHaveLength(0)
      expect(internals(jobManager).scheduleDisposables.has(spent.id)).toBe(false)

      await teardownManager(scheduler, jobManager)
    })

    it('preserves a limit-cron quota across the pause window (croner-level pause)', async () => {
      const counter = { count: 0 }
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['pause.cronq', makeCountingHandler(counter)]],
        fakeDate: true,
        keepFakeTimers: true
      })

      jobManager.registerJobSchedule({
        type: 'pause.cronq',
        trigger: { kind: 'cron', expr: '* * * * * *', limit: 1 },
        jobInputTemplate: { message: 'quota' },
        catchUpPolicy: { kind: 'skip-missed' }
      } as never)

      const hold = jobManager.pause('test: cron quota')
      // ≥2 calendar fire points elapse while croner is natively paused — a
      // callback-body-only gate would burn maxRuns here and kill the schedule.
      await vi.advanceTimersByTimeAsync(2500)
      expect(jobService.list({ type: 'pause.cronq' })).toHaveLength(0)

      hold.dispose()
      await vi.advanceTimersByTimeAsync(2500)
      expect(jobService.list({ type: 'pause.cronq' })).toHaveLength(1)

      // Quota is spent now — no further fires.
      await vi.advanceTimersByTimeAsync(3000)
      expect(jobService.list({ type: 'pause.cronq' })).toHaveLength(1)

      vi.useRealTimers()
      await drainTrailingDispatch(jobManager)
      await teardownManager(scheduler, jobManager)
    })

    it('pauses crons registered while paused (no fire window); they fire after release', async () => {
      const counter = { count: 0 }
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['pause.cronreg', makeCountingHandler(counter)]],
        fakeDate: true,
        keepFakeTimers: true
      })

      const hold = jobManager.pause('test: cron registered while paused')
      const { id } = jobManager.registerJobSchedule({
        type: 'pause.cronreg',
        trigger: { kind: 'cron', expr: '* * * * * *' },
        jobInputTemplate: { message: 'late-reg' },
        catchUpPolicy: { kind: 'skip-missed' }
      } as never)

      await vi.advanceTimersByTimeAsync(2500)
      expect(jobService.list({ type: 'pause.cronreg' })).toHaveLength(0)

      hold.dispose()
      await vi.advanceTimersByTimeAsync(1500)
      expect(jobService.list({ type: 'pause.cronreg' }).length).toBeGreaterThanOrEqual(1)
      expect(jobScheduleService.getById(id)!.lastRun).not.toBeNull()

      vi.useRealTimers()
      await drainTrailingDispatch(jobManager)
      await teardownManager(scheduler, jobManager)
    })

    it('does not resume crons removed during the pause window — per-schedule pause stays orthogonal', async () => {
      const counter = { count: 0 }
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['pause.cronrm', makeCountingHandler(counter)]]
      })

      const { id } = jobManager.registerJobSchedule({
        type: 'pause.cronrm',
        trigger: { kind: 'cron', expr: '* * * * * *' },
        jobInputTemplate: { message: 'removed' },
        catchUpPolicy: { kind: 'skip-missed' }
      } as never)
      expect(scheduler.has(`schedule:${id}`)).toBe(true)

      const hold = jobManager.pause('test: per-schedule orthogonal')
      // Per-schedule pause during the global window removes the entry entirely.
      expect(await jobManager.pauseJobScheduleById(id)).toBe(true)
      expect(scheduler.has(`schedule:${id}`)).toBe(false)

      hold.dispose()
      await sleep(50)
      // Release must not resurrect or resume it: still disabled, still unarmed.
      expect(jobScheduleService.getById(id)!.enabled).toBe(false)
      expect(scheduler.has(`schedule:${id}`)).toBe(false)
      expect(internals(jobManager).scheduleDisposables.has(id)).toBe(false)
      expect(jobService.list({ type: 'pause.cronrm' })).toHaveLength(0)

      await teardownManager(scheduler, jobManager)
    })
  })

  // -------------------------------------------------------------------------
  // onStop drain regression (pre-existing gaps, fixed alongside — §6)
  // -------------------------------------------------------------------------

  describe('onStop drain regression', () => {
    it('waits for cross-restart dispatched jobs that have no finished resolver', async () => {
      const dbh = MockMainDbServiceExport.dbService.getDb() as DbType
      const now = Date.now()
      const [inserted] = await dbh
        .insert(jobTable)
        .values({
          type: 'stop.xrestart',
          status: 'running',
          queue: 'stop.xrestart',
          scheduledAt: now - 1000,
          startedAt: now - 800,
          attempt: 0,
          maxAttempts: 2,
          input: { message: 'previous-run' },
          cancelRequested: false,
          metadata: {}
        })
        .returning()

      const counter = { count: 0 }
      const gate = makeGate()
      const { scheduler, jobManager } = await bootstrapManager({
        // The abort rejection is delayed so a premature onStop return is
        // observable as a still-running row.
        handlers: [['stop.xrestart', makeGateHandler(counter, gate.promise, { abortDelayMs: 50 })]]
      })

      await pollUntil(() => internals(jobManager).inFlightExecuted.has(inserted.id))
      expect(internals(jobManager).finishedResolvers.has(inserted.id)).toBe(false)

      await jobManager._doStop()
      // onStop must have waited for the executor signal — the row reached a
      // terminal state before shutdown returned.
      expect(jobService.getById(inserted.id)?.status).toBe('cancelled')

      await scheduler._doStop()
    })

    it('waits for onSettled to finish before declaring jobs settled', async () => {
      const counter = { count: 0 }
      const gate = makeGate()
      let settledDone = false
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [
          [
            'stop.settle',
            makeGateHandler(counter, gate.promise, {
              onSettled: async () => {
                await sleep(100)
                settledDone = true
              }
            })
          ]
        ]
      })

      const handle = jobManager.enqueue('stop.settle' as never, { message: 'x' } as never)
      await pollUntil(() => jobService.getById(handle.id)?.status === 'running')

      await jobManager._doStop()
      // `finished` resolves before onSettled runs — waiting on it would return
      // here with settledDone still false and the breaker write in flight.
      expect(settledDone).toBe(true)

      await scheduler._doStop()
    })
  })

  // -------------------------------------------------------------------------
  // Interactions
  // -------------------------------------------------------------------------

  describe('interactions', () => {
    it('onStop shuts down normally while paused; disposing a hold after shutdown is a no-op', async () => {
      const counter = { count: 0 }
      const gate = makeGate()
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['pause.stop', makeGateHandler(counter, gate.promise)]]
      })

      const handle = jobManager.enqueue('pause.stop' as never, { message: 'x' } as never)
      await pollUntil(() => jobService.getById(handle.id)?.status === 'running')

      const hold = jobManager.pause('test: onStop while paused')
      await jobManager._doStop()
      expect(jobService.getById(handle.id)?.status).toBe('cancelled')

      // Shutdown wins over pause bookkeeping: a late dispose must not run
      // compensation against a stopped service (and must not throw).
      expect(() => hold.dispose()).not.toThrow()

      await scheduler._doStop()
    })

    it('happy path: paused and never released — no leaks, no unhandled rejections', async () => {
      const unhandled: unknown[] = []
      const listener = (reason: unknown) => unhandled.push(reason)
      process.on('unhandledRejection', listener)

      const { scheduler, jobManager } = await bootstrapManager()

      jobManager.pause('restore happy path — never released')
      const verdict = await jobManager.drainInFlight({ timeoutMs: 200 })
      expect(verdict).toEqual({ stragglerIds: [], startupRecoveryPending: false })

      // Simulated process exit while still paused.
      await teardownManager(scheduler, jobManager)

      await sleep(50)
      expect(unhandled).toHaveLength(0)
      process.off('unhandledRejection', listener)
    })
  })
})
