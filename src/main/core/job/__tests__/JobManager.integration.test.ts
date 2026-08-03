/**
 * Integration tests for the Job/Scheduler backbone.
 *
 * Covers scenarios that smoke tests deliberately skip:
 *   - Startup recovery: abandon / retry / singleton state transitions across
 *     "process restart" (modelled by inserting rows directly to simulate a
 *     crash, then bootstrapping a fresh JobManager whose onAllReady runs
 *     runStartupRecovery + queue resurrection)
 *   - Orphan running jobs (handler no longer registered) → cancelled
 *   - Pending row resurrection: pre-existing pending row from a previous run
 *     is dispatched to completion after onAllReady (covers the case where the
 *     in-memory queue Map is empty on cold start and dispatchAll would
 *     otherwise iterate nothing)
 *   - Graceful shutdown: handlers observe AbortSignal and finish promptly
 *   - Layer 0 write tx + Layer 1 mutex: multiple queues dispatching in parallel
 *     all commit without contention or SQLITE_BUSY
 *
 * Note on scope: retry / singleton cases assert the full recovery →
 * resurrect → dispatch → completed chain. The terminal assertion is load-
 * bearing — without queue resurrection the row would stay pending forever
 * on cold start, so reaching completed is the actual contract these tests
 * enforce.
 */

import { application } from '@application'
import { jobScheduleTable, jobTable } from '@data/db/schemas/job'
import type { DbType } from '@data/db/types'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { jobService } from '@data/services/JobService'
import { JobManager } from '@main/core/job/JobManager'
import type { JobHandle, JobHandler, JobSettledEvent } from '@main/core/job/types'
import { EnqueueBatchValidationError } from '@main/core/job/types'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { SchedulerService } from '@main/core/scheduler/SchedulerService'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainCacheServiceExport } from '@test-mocks/main/CacheService'
import { MockMainDbServiceExport } from '@test-mocks/main/DbService'
import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { drainTrailingDispatch } from './_helpers'

vi.mock('@application', async () => {
  const mod = await import('@test-mocks/main/application')
  return mod.mockApplicationFactory()
})

interface SlowInput {
  message: string
  sleepMs?: number
}

interface SlowOutput {
  echoed: string
}

/**
 * Set by a test that needs to know a slow handler is genuinely parked in its
 * abortable await, instead of sleeping a fixed interval and hoping (#17703).
 */
let onSlowHandlerEntered: (() => void) | null = null

function makeSlowHandler(recovery: 'abandon' | 'retry' | 'singleton'): JobHandler<SlowInput> {
  return {
    recovery,
    cancelTimeoutMs: 1500,
    defaultConcurrency: 4,
    async execute(ctx) {
      const delay = ctx.input.sleepMs ?? 30
      await new Promise<void>((resolve, reject) => {
        if (ctx.signal.aborted) return reject(new Error('AbortError'))
        const t = setTimeout(() => resolve(), delay)
        ctx.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(t)
            reject(new Error('AbortError'))
          },
          { once: true }
        )
        onSlowHandlerEntered?.()
      })
      return { echoed: `echo: ${ctx.input.message}` } satisfies SlowOutput
    }
  }
}

// Local alias so test bodies read naturally; implementation in _helpers.ts.
async function drainAllQueues(jm: JobManager): Promise<void> {
  return drainTrailingDispatch(jm)
}

interface BootstrapOptions {
  /** Register these handlers BEFORE _doInit so onReady's recovery sees them. */
  handlers?: Array<[string, JobHandler]>
  /**
   * Invoked after `_doAllReady()` schedules the quiet-window timer but before
   * it is advanced — models calls arriving before startup recovery runs.
   * Receives the JobManager being bootstrapped (the caller's destructured
   * binding does not exist yet at hook time).
   */
  beforeRecovery?: (jobManager: JobManager) => Promise<void> | void
  /**
   * Return while fake timers are still installed so the test can advance
   * schedule timers armed during recovery (their due time lies beyond the
   * quiet-window advance, and `useRealTimers` would discard them). The
   * caller MUST call `vi.useRealTimers()` itself.
   */
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

  // Handlers must be registered BEFORE _doInit so JobManager.onAllReady's
  // runStartupRecovery sees them. Without registration, all non-terminal jobs
  // for that type are treated as orphans and cancelled.
  for (const [type, h] of opts.handlers ?? []) {
    jobManager.registerHandler(type as never, h)
  }

  await scheduler._doInit()
  await jobManager._doInit()

  // Startup recovery now runs as a deferred service-level task: `onAllReady`
  // schedules a setTimeout (60s "quiet window") and returns synchronously (the
  // framework fires `_doAllReady` fire-and-forget). Skip the quiet window via
  // fake timers — `toFake` must pair setTimeout with clearTimeout, otherwise
  // the timer queue keeps dangling entries — then await `_recoveryDone` (set
  // inside the timer callback) for the deferred flow.
  //
  // The recovery flow resurrects queues for non-terminal rows and `dispatchAll`
  // immediately claims them. The dispatch microtask chain runs *after* the
  // recovery promise resolves but *before* useRealTimers. If we switch back to
  // real timers at that moment, the handler's internal setTimeout (registered
  // as a fake timer while we're still in fake mode) gets cancelled and the
  // handler hangs forever. Drain the dispatch chain under fake timers —
  // advance generously so handler internal sleeps fire and finalizeJob
  // completes before we switch back.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  void jobManager._doAllReady()
  if (opts.beforeRecovery) await opts.beforeRecovery(jobManager)
  await vi.advanceTimersByTimeAsync(60_000)
  await (jobManager as unknown as { _recoveryDone?: Promise<void> })._recoveryDone
  for (let i = 0; i < 5; i++) {
    await vi.advanceTimersByTimeAsync(100)
  }
  if (!opts.keepFakeTimers) vi.useRealTimers()
  return { scheduler, jobManager }
}

async function teardownManager(scheduler: SchedulerService, jobManager: JobManager): Promise<void> {
  // Surface shutdown errors — a regression in _doStop should fail the suite.
  await jobManager._doStop()
  await scheduler._doStop()
}

describe('JobManager integration', () => {
  setupTestDatabase()

  beforeAll(() => {
    BaseService.resetInstances()
  })

  describe('startup recovery', () => {
    it('abandon: turns every non-terminal job into cancelled', async () => {
      const dbh = MockMainDbServiceExport.dbService.getDb() as DbType

      const now = Date.now()
      await dbh.insert(jobTable).values([
        {
          type: 'task.abandon',
          status: 'running',
          queue: 'task.abandon',
          scheduledAt: now - 1000,
          startedAt: now - 800,
          attempt: 0,
          maxAttempts: 1,
          input: { message: 'a' },
          cancelRequested: false,
          metadata: {}
        },
        {
          type: 'task.abandon',
          status: 'delayed',
          queue: 'task.abandon',
          scheduledAt: now + 60_000,
          attempt: 0,
          maxAttempts: 1,
          input: { message: 'b' },
          cancelRequested: false,
          metadata: {}
        }
      ])

      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['task.abandon', makeSlowHandler('abandon') as JobHandler]]
      })

      const all = jobService.list({ type: 'task.abandon' })
      expect(all).toHaveLength(2)
      expect(all.every((r) => r.status === 'cancelled')).toBe(true)
      expect(all.every((r) => r.error?.code === 'JOB_CANCELLED')).toBe(true)

      await teardownManager(scheduler, jobManager)
    })

    it('retry: resets running → pending, leaves delayed jobs alone', async () => {
      const dbh = MockMainDbServiceExport.dbService.getDb() as DbType

      const now = Date.now()
      const inserted = await dbh
        .insert(jobTable)
        .values([
          {
            type: 'task.retry',
            status: 'running',
            queue: 'task.retry',
            scheduledAt: now - 1000,
            startedAt: now - 800,
            attempt: 0,
            maxAttempts: 2,
            input: { message: 'r-running' },
            cancelRequested: false,
            metadata: {}
          },
          {
            type: 'task.retry',
            status: 'delayed',
            queue: 'task.retry',
            scheduledAt: now + 60_000,
            attempt: 0,
            maxAttempts: 2,
            input: { message: 'r-delayed' },
            cancelRequested: false,
            metadata: {}
          }
        ])
        .returning()

      const runningId = inserted.find((r) => r.status === 'running')!.id
      const delayedId = inserted.find((r) => r.status === 'delayed')!.id

      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['task.retry', makeSlowHandler('retry') as JobHandler]]
      })

      // recovery: running → pending. Queue resurrection then ensures the
      // task.retry queue and dispatches, so the row proceeds through running
      // back to the handler — assert the terminal completed state, not the
      // transient pending one.
      await drainAllQueues(jobManager)
      const deadline = Date.now() + 1000
      while (Date.now() < deadline) {
        const row = jobService.getById(runningId)
        if (row && row.status !== 'pending' && row.status !== 'running') break
        await new Promise((r) => setTimeout(r, 20))
      }
      await drainAllQueues(jobManager)

      const finalRunning = jobService.getById(runningId)
      expect(finalRunning?.status).toBe('completed')

      // delayed remains delayed until its scheduledAt arrives (+60s in future).
      const finalDelayed = jobService.getById(delayedId)
      expect(finalDelayed?.status).toBe('delayed')

      await teardownManager(scheduler, jobManager)
    })

    it('retry: leaves a job already executing in THIS process alone (no double-dispatch)', async () => {
      // Regression for #16291: a job enqueued + started during the startup quiet
      // window is still `running` when the recovery sweep fires. Without the
      // in-flight guard the retry strategy resets that running row → pending and
      // dispatchAll re-claims it, running the handler a SECOND time for one
      // enqueue. The handler must execute exactly once.
      let executeCount = 0
      let releaseGate!: () => void
      const gate = new Promise<void>((resolve) => {
        releaseGate = resolve
      })
      const gateHandler: JobHandler<SlowInput> = {
        recovery: 'retry',
        cancelTimeoutMs: 1500,
        defaultConcurrency: 1,
        async execute(ctx) {
          executeCount++
          // Park on a manually-resolved gate (NOT a setTimeout, which would be
          // a faked timer and could fire mid-sweep), staying in-flight until the
          // test releases it. Still honor abort so shutdown/cancel stays clean.
          await new Promise<void>((resolve, reject) => {
            if (ctx.signal.aborted) return reject(new Error('AbortError'))
            const onAbort = () => reject(new Error('AbortError'))
            ctx.signal.addEventListener('abort', onAbort, { once: true })
            void gate.then(() => {
              ctx.signal.removeEventListener('abort', onAbort)
              resolve()
            })
          })
          return { echoed: `echo: ${ctx.input.message}` } satisfies SlowOutput
        }
      }

      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['inflight.guard', gateHandler as JobHandler]]
      })

      // Enqueue + let it start executing: the row is `running` in the DB and the
      // jobId is in inFlightExecuted, with execute() parked on the gate.
      const handle = jobManager.enqueue('inflight.guard' as never, { message: 'x' } as never)
      await drainAllQueues(jobManager)
      expect(executeCount).toBe(1)
      expect(jobService.getById(handle.id)?.status).toBe('running')

      // Run the startup-recovery sweep WHILE the job is genuinely in-flight in
      // this process. Invoked directly — the same flow the 60s timer triggers —
      // to keep the test deterministic without re-driving fake timers.
      await (jobManager as unknown as { runStartupRecoveryFlow: () => Promise<void> }).runStartupRecoveryFlow()

      // This assertion is NEGATIVE (count must NOT grow), so give any buggy
      // re-dispatch ample opportunity to land before asserting — drain + settle
      // repeatedly so a slow second spawn can't slip past a single drain and
      // leave the test a false negative.
      for (let i = 0; i < 5; i++) {
        await drainAllQueues(jobManager)
        await new Promise((r) => setTimeout(r, 20))
      }

      // Positive signal: recovery left the live row alone (still `running`, not
      // reset to `pending`). Load-bearing negative: handler ran exactly once.
      expect(jobService.getById(handle.id)?.status).toBe('running')
      expect(executeCount).toBe(1)

      // Release the gate → the single execution finalizes the row once.
      releaseGate()
      const settled = await handle.finished
      expect(settled.status).toBe('completed')
      expect(executeCount).toBe(1)

      await teardownManager(scheduler, jobManager)
    })

    it('singleton: keeps the newest non-terminal, cancels older ones', async () => {
      const dbh = MockMainDbServiceExport.dbService.getDb() as DbType

      const t0 = Date.now() - 5000
      const inserted = await dbh
        .insert(jobTable)
        .values([
          {
            type: 'task.singleton',
            status: 'running',
            queue: 'task.singleton',
            scheduledAt: t0,
            startedAt: t0 + 100,
            attempt: 0,
            maxAttempts: 1,
            input: { message: 'older' },
            cancelRequested: false,
            metadata: {},
            createdAt: t0
          },
          {
            type: 'task.singleton',
            status: 'pending',
            queue: 'task.singleton',
            scheduledAt: t0 + 1000,
            attempt: 0,
            maxAttempts: 1,
            input: { message: 'newer' },
            cancelRequested: false,
            metadata: {},
            createdAt: t0 + 1000
          }
        ])
        .returning()

      const olderId = inserted.find((r) => (r.input as { message: string }).message === 'older')!.id
      const newerId = inserted.find((r) => (r.input as { message: string }).message === 'newer')!.id

      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['task.singleton', makeSlowHandler('singleton') as JobHandler]]
      })

      // singleton recovery: keep newest non-terminal (newer = pending), cancel
      // older (running). Queue resurrection then ensures the task.singleton
      // queue and dispatches `newer` through to completion.
      await drainAllQueues(jobManager)
      const deadline = Date.now() + 1000
      while (Date.now() < deadline) {
        const row = jobService.getById(newerId)
        if (row && row.status !== 'pending' && row.status !== 'running') break
        await new Promise((r) => setTimeout(r, 20))
      }
      await drainAllQueues(jobManager)

      const finalOlder = jobService.getById(olderId)
      const finalNewer = jobService.getById(newerId)
      expect(finalOlder?.status).toBe('cancelled')
      expect(finalNewer?.status).toBe('completed')

      await teardownManager(scheduler, jobManager)
    })

    it('orphan running jobs (handler no longer registered) are cancelled', async () => {
      const dbh = MockMainDbServiceExport.dbService.getDb() as DbType

      await dbh.insert(jobTable).values({
        type: 'task.gone',
        status: 'running',
        queue: 'task.gone',
        scheduledAt: Date.now(),
        startedAt: Date.now(),
        attempt: 0,
        maxAttempts: 1,
        input: 'orphan',
        cancelRequested: false,
        metadata: {}
      })

      // Intentionally do NOT register task.gone — it's an orphan.
      const { scheduler, jobManager } = await bootstrapManager()

      const orphans = await dbh.select().from(jobTable).where(eq(jobTable.type, 'task.gone'))
      expect(orphans).toHaveLength(1)
      expect(orphans[0].status).toBe('cancelled')

      await teardownManager(scheduler, jobManager)
    })

    it('resurrects a pending row left from a previous run after onAllReady', async () => {
      const dbh = MockMainDbServiceExport.dbService.getDb() as DbType

      // Pre-insert pending row simulating "process died with row in pending,
      // no queue ever ensured in memory". scheduledAt in past so immediately
      // claimable. Without queue resurrection, dispatchAll() would iterate
      // empty this.queues and never claim this row.
      const [inserted] = await dbh
        .insert(jobTable)
        .values({
          type: 'task.f13',
          status: 'pending',
          queue: 'task.f13',
          scheduledAt: Date.now() - 1000,
          attempt: 0,
          maxAttempts: 1,
          input: { message: 'resurrected', sleepMs: 5 },
          cancelRequested: false,
          metadata: {}
        })
        .returning()

      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['task.f13', makeSlowHandler('retry') as JobHandler]]
      })

      // bootstrapManager already advanced fake timers past the startup quiet
      // window and awaited `_recoveryDone`, so resurrection has run. Handler
      // is spawned outside the dispatch mutex — drain + poll with explicit
      // deadline so timeout surfaces cleanly.
      await drainAllQueues(jobManager)
      const deadline = Date.now() + 1000
      while (Date.now() < deadline) {
        const row = jobService.getById(inserted.id)
        if (row && row.status !== 'pending' && row.status !== 'running') break
        await new Promise((r) => setTimeout(r, 20))
      }
      await drainAllQueues(jobManager)

      const final = jobService.getById(inserted.id)
      expect(final?.status).toBe('completed')
      expect(final?.output).toEqual({ echoed: 'echo: resurrected' })

      await teardownManager(scheduler, jobManager)
    })
  })

  describe('startup recovery — once schedules', () => {
    const onceNoopHandler: JobHandler = {
      recovery: 'abandon',
      cancelTimeoutMs: 1000,
      defaultConcurrency: 1,
      async execute() {
        return {}
      }
    }

    function armedScheduleIds(jm: JobManager): Set<string> {
      return new Set((jm as unknown as { scheduleDisposables: Map<string, unknown> }).scheduleDisposables.keys())
    }

    it('does not re-arm a spent once schedule (fired one-shot must not replay on restart)', async () => {
      const dbh = MockMainDbServiceExport.dbService.getDb() as DbType
      const now = Date.now()
      const [row] = await dbh
        .insert(jobScheduleTable)
        .values({
          type: 'task.once',
          trigger: { kind: 'once', at: now - 60_000 },
          jobInputTemplate: { message: 'spent' },
          enabled: true,
          lastRun: now - 60_000,
          nextRun: null,
          catchUpPolicy: { kind: 'skip-missed' },
          metadata: {}
        })
        .returning()

      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['task.once', onceNoopHandler]]
      })
      await drainAllQueues(jobManager)

      expect(jobService.list({ type: 'task.once' })).toHaveLength(0)
      expect(armedScheduleIds(jobManager).has(row.id)).toBe(false)

      await teardownManager(scheduler, jobManager)
    })

    it('re-arms and fires a never-fired once schedule whose at-time passed while the app was closed', async () => {
      const dbh = MockMainDbServiceExport.dbService.getDb() as DbType
      const now = Date.now()
      await dbh.insert(jobScheduleTable).values({
        type: 'task.once',
        trigger: { kind: 'once', at: now - 60_000 },
        jobInputTemplate: { message: 'missed' },
        enabled: true,
        lastRun: null,
        nextRun: null,
        catchUpPolicy: { kind: 'skip-missed' },
        metadata: {}
      })

      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['task.once', onceNoopHandler]]
      })
      await drainAllQueues(jobManager)

      expect(jobService.list({ type: 'task.once' })).toHaveLength(1)

      await teardownManager(scheduler, jobManager)
    })

    it('re-arms a manually pre-fired once schedule whose natural fire is still pending', async () => {
      const dbh = MockMainDbServiceExport.dbService.getDb() as DbType
      const now = Date.now()
      const [row] = await dbh
        .insert(jobScheduleTable)
        .values({
          type: 'task.once',
          trigger: { kind: 'once', at: now + 600_000 },
          jobInputTemplate: { message: 'pending-natural-fire' },
          enabled: true,
          // Manual trigger writes lastRun before the natural fire happens
          // (triggerJobScheduleNowById's non-cron fallback) — a bare lastRun
          // null-check would wrongly treat this schedule as spent.
          lastRun: now - 1_000,
          nextRun: null,
          catchUpPolicy: { kind: 'skip-missed' },
          metadata: {}
        })
        .returning()

      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['task.once', onceNoopHandler]]
      })
      await drainAllQueues(jobManager)

      expect(jobService.list({ type: 'task.once' })).toHaveLength(0)
      expect(armedScheduleIds(jobManager).has(row.id)).toBe(true)

      await teardownManager(scheduler, jobManager)
    })

    it('persists a natural fire clamped to trigger.at so an early fire does not replay on restart', async () => {
      const dbh = MockMainDbServiceExport.dbService.getDb() as DbType
      // The once timer elapses on fake timers while Date.now() stays on the
      // real clock — advancing 31s fires the timer while wall time barely
      // moves, an amplified reproduction of the monotonic/wall-clock mismatch
      // that makes natural fires observe Date.now() < trigger.at.
      const at = Date.now() + 30_000
      const [row] = await dbh
        .insert(jobScheduleTable)
        .values({
          type: 'task.once',
          trigger: { kind: 'once', at },
          jobInputTemplate: { message: 'early-natural-fire' },
          enabled: true,
          lastRun: null,
          nextRun: null,
          catchUpPolicy: { kind: 'skip-missed' },
          metadata: {}
        })
        .returning()

      const boot1 = await bootstrapManager({
        handlers: [['task.once', onceNoopHandler]],
        keepFakeTimers: true
      })
      await vi.advanceTimersByTimeAsync(31_000)
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(100)
      }
      vi.useRealTimers()
      await drainAllQueues(boot1.jobManager)

      expect(jobService.list({ type: 'task.once' })).toHaveLength(1)
      const fired = jobScheduleService.getById(row.id)
      expect(fired?.lastRun).not.toBeNull()
      expect(Date.parse(fired!.lastRun!)).toBeGreaterThanOrEqual(at)

      await teardownManager(boot1.scheduler, boot1.jobManager)

      // Simulated restart: the spent row must be skipped, not replayed.
      const boot2 = await bootstrapManager({
        handlers: [['task.once', onceNoopHandler]]
      })
      await drainAllQueues(boot2.jobManager)

      expect(jobService.list({ type: 'task.once' })).toHaveLength(1)
      expect(armedScheduleIds(boot2.jobManager).has(row.id)).toBe(false)

      await teardownManager(boot2.scheduler, boot2.jobManager)
    })

    it('treats a manual fire of an overdue never-fired once as its fire — no make-up run after recovery', async () => {
      const dbh = MockMainDbServiceExport.dbService.getDb() as DbType
      const now = Date.now()
      const [row] = await dbh
        .insert(jobScheduleTable)
        .values({
          type: 'task.once',
          trigger: { kind: 'once', at: now - 60_000 },
          jobInputTemplate: { message: 'manual-during-quiet-window' },
          enabled: true,
          lastRun: null,
          nextRun: null,
          catchUpPolicy: { kind: 'skip-missed' },
          metadata: {}
        })
        .returning()

      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['task.once', onceNoopHandler]],
        beforeRecovery: async (bootingManager) => {
          expect(await bootingManager.triggerJobScheduleNowById(row.id)).toBe(true)
        }
      })
      await drainAllQueues(jobManager)

      expect(jobService.list({ type: 'task.once' })).toHaveLength(1)
      expect(armedScheduleIds(jobManager).has(row.id)).toBe(false)

      await teardownManager(scheduler, jobManager)
    })
  })

  describe('graceful shutdown', () => {
    it('aborts in-flight handlers and resolves the finished promise quickly', async () => {
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['shutdown.slow', makeSlowHandler('retry') as JobHandler]]
      })

      const entered = new Promise<void>((resolve) => {
        onSlowHandlerEntered = resolve
      })

      const handle = jobManager.enqueue(
        'shutdown.slow' as never,
        {
          message: 'long',
          sleepMs: 5000
        } as never
      )

      // Wait for dispatch + handler.execute to be inside its await — the handler
      // signals that itself, so _doStop() cannot race a fixed sleep.
      await drainAllQueues(jobManager)
      await entered
      onSlowHandlerEntered = null

      const stopPromise = jobManager._doStop()
      const settled = await handle.finished
      expect(settled.status).toBe('cancelled')

      await stopPromise
      await teardownManager(scheduler, jobManager)
    })
  })

  describe('Layer 0 + Layer 1 mutex serialization', () => {
    it('handles 20 queues firing in parallel without SQLITE_BUSY', async () => {
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['parallel.task', makeSlowHandler('abandon') as JobHandler]]
      })

      const handles = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          jobManager.enqueue(
            'parallel.task' as never,
            { message: `n-${i}`, sleepMs: 5 } as never,
            {
              queue: `parallel-${i}`
            } as never
          )
        )
      )

      const settled = await Promise.all(handles.map((h) => h.finished))
      expect(settled.every((s) => s.status === 'completed')).toBe(true)

      await drainAllQueues(jobManager)
      await teardownManager(scheduler, jobManager)
    })
  })

  describe('global cap cross-queue wakeup', () => {
    // Regression: when a dispatch is blocked purely by the GLOBAL concurrency
    // cap (the queue itself has free slots), a job finishing on a DIFFERENT
    // queue must re-kick all queues — not just the finished job's own queue.
    // Previously resolveAndDispatch only dispatched snapshot.queue, so a queue
    // starved solely by the global cap stalled until the next 5-minute promotion
    // tick or a fresh enqueue (a lost wakeup).
    it('re-dispatches a globally-starved queue after a global slot frees', async () => {
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['cap.task', makeSlowHandler('abandon') as JobHandler]]
      })
      // Force the global cap to bind with a single slot.
      ;(jobManager as unknown as { globalMaxConcurrency: number }).globalMaxConcurrency = 1

      // Queue qB occupies the only global slot with a slow job.
      const occupant = jobManager.enqueue(
        'cap.task' as never,
        { message: 'occupant', sleepMs: 150 } as never,
        { queue: 'qB' } as never
      )
      await drainAllQueues(jobManager)

      // Queue qA is enqueued while the global cap is saturated → blocked pending,
      // even though qA's own per-queue slots are free.
      const starved = jobManager.enqueue(
        'cap.task' as never,
        { message: 'starved', sleepMs: 10 } as never,
        { queue: 'qA' } as never
      )

      // Pin the regression deterministically: qA's dispatch must have observed
      // the global cap saturated and set the flag. Drain first so qA's (fire-and-
      // forget) dispatch tx has run — async-mutex is FIFO, so qA's earlier
      // mutex.acquire() resolves before drain's, guaranteeing the flag is set by
      // the time drain returns. Without this assertion the test could pass
      // vacuously if timing left a global slot free at qA enqueue time.
      await drainAllQueues(jobManager)
      expect((jobManager as unknown as { globalCapReached: boolean }).globalCapReached).toBe(true)

      // Occupant finishes → frees the global slot → must wake qA.
      await occupant.finished
      const settled = await starved.finished
      expect(settled.status).toBe('completed')

      await drainAllQueues(jobManager)
      await teardownManager(scheduler, jobManager)
    })
  })

  describe('scheduleRetry persistence failure → fallback finalize', () => {
    it('degrades to failed(retryable=true) when retry tx persistently fails (non-BUSY)', async () => {
      // Handler always throws a retryable error so JobManager attempts retry.
      const handler: JobHandler = {
        recovery: 'retry',
        cancelTimeoutMs: 500,
        defaultConcurrency: 2,
        async execute() {
          throw new Error('handler-intentional-failure')
        }
      }
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['retry.fallback.task', handler]]
      })

      // Capture unhandled rejections to assert none leak from the fallback chain.
      const unhandled: unknown[] = []
      const listener = (reason: unknown) => unhandled.push(reason)
      process.on('unhandledRejection', listener)

      // Persistently fail the retry persist path with a non-BUSY error so
      // withWriteTx does NOT retry (only BUSY is retried) — the failure
      // propagates back to scheduleRetry, triggering the fallback finalize.
      const retrySpy = vi.spyOn(jobService, 'setDelayedRetryTx').mockImplementation(() => {
        throw Object.assign(new Error('synthetic-corrupt'), { code: 'SQLITE_CORRUPT' })
      })

      const handle = jobManager.enqueue(
        'retry.fallback.task' as never,
        { message: 'doomed' } as never,
        { maxAttempts: 3 } as never
      )

      // Drive the dispatch + handler.execute + fallback finalize chain to
      // completion. Poll the row instead of using a fixed sleep — the
      // exact ordering of microtasks across enqueue → dispatch → spawnExecute
      // → catch → scheduleRetry → fallback finalizeJob is timing-sensitive
      // and a flat 50 ms can be flaky under load.
      const deadline = Date.now() + 3000
      let final: Awaited<ReturnType<typeof jobService.getById>> = null
      while (Date.now() < deadline) {
        await drainAllQueues(jobManager)
        await new Promise((r) => setTimeout(r, 20))
        final = jobService.getById(handle.id)
        if (final?.status === 'failed') break
      }

      expect(final?.status).toBe('failed')
      expect(final?.error?.retryable).toBe(true)
      expect(final?.error?.message).toContain('Retry persist failed')

      expect(unhandled).toHaveLength(0)

      process.off('unhandledRejection', listener)
      retrySpy.mockRestore()
      await teardownManager(scheduler, jobManager)
    })

    it('outer .catch chain swallows leaked errors even when fallback finalize also throws', async () => {
      const handler: JobHandler = {
        recovery: 'retry',
        cancelTimeoutMs: 500,
        defaultConcurrency: 2,
        async execute() {
          throw new Error('handler-intentional-failure')
        }
      }
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['retry.fallback.task.2', handler]]
      })

      const unhandled: unknown[] = []
      const listener = (reason: unknown) => unhandled.push(reason)
      process.on('unhandledRejection', listener)

      // Force both writes to fail so the §D outer .catch path becomes the
      // last line of defense.
      const retrySpy = vi.spyOn(jobService, 'setDelayedRetryTx').mockImplementation(() => {
        throw Object.assign(new Error('synthetic-corrupt'), { code: 'SQLITE_CORRUPT' })
      })
      const terminalSpy = vi.spyOn(jobService, 'setTerminalTx').mockImplementation(() => {
        throw Object.assign(new Error('synthetic-corrupt-terminal'), { code: 'SQLITE_CORRUPT' })
      })

      jobManager.enqueue(
        'retry.fallback.task.2' as never,
        { message: 'doubled-doom' } as never,
        { maxAttempts: 3 } as never
      )

      // Drive the dispatch + handler + fallback chain. With both retry and
      // terminal writes mocked to fail, the production code falls all the
      // way through to synthesizeFailedSnapshot in finalizeJob and then
      // exits the IIFE via the finally block. We assert only the absence
      // of unhandled rejections — the DB row is intentionally left in
      // 'running' (which the watchdog or startup recovery would reclaim
      // in production).
      await drainAllQueues(jobManager)
      await new Promise((r) => setTimeout(r, 100))

      expect(unhandled).toHaveLength(0)

      process.off('unhandledRejection', listener)
      retrySpy.mockRestore()
      terminalSpy.mockRestore()
      await teardownManager(scheduler, jobManager)
    })
  })

  describe('settled event payload', () => {
    it('delivers input / parentId / final metadata to onSettled and exposes ctx.parentId', async () => {
      const settledEvents: JobSettledEvent<{ label: string }>[] = []
      const ctxParentIds: Array<string | null> = []
      const handler: JobHandler<{ label: string }> = {
        recovery: 'abandon',
        async execute(ctx) {
          ctxParentIds.push(ctx.parentId)
          // Patch metadata mid-execution: the settled event must carry the
          // FINAL merged value, not the enqueue-time one.
          await ctx.patchMetadata({ phase: 'done' })
          return { ok: true }
        },
        onSettled(event) {
          settledEvents.push(event)
        }
      }
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['settled.payload', handler as JobHandler]]
      })

      // parentId has a self-referencing FK — the parent must be a real row.
      const parent = jobManager.enqueue('settled.payload' as never, { label: 'parent' } as never)
      await parent.finished

      const child = jobManager.enqueue(
        'settled.payload' as never,
        { label: 'child' } as never,
        {
          parentId: parent.id,
          metadata: { origin: 'test' }
        } as never
      )
      const snapshot = await child.finished
      expect(snapshot.status).toBe('completed')

      expect(ctxParentIds).toEqual([null, parent.id])
      expect(settledEvents).toHaveLength(2)
      const childEvent = settledEvents[1]
      expect(childEvent.input).toEqual({ label: 'child' })
      expect(childEvent.parentId).toBe(parent.id)
      expect(childEvent.metadata).toEqual({ origin: 'test', phase: 'done' })
      expect(settledEvents[0].parentId).toBeNull()

      await drainAllQueues(jobManager)
      await teardownManager(scheduler, jobManager)
    })
  })

  describe('enqueueTx (transactional enqueue)', () => {
    // These cases MUST run inside a REAL drizzle transaction from the
    // setupTestDatabase handle: the mock DbService.withWriteTx has no
    // transaction (it passes the bare db, auto-committing per statement),
    // so the rollback case would falsely fail through it.

    it('commits the job with the caller transaction and dispatches after commit', async () => {
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['tx.task', makeSlowHandler('abandon') as JobHandler]]
      })
      const db = MockMainDbServiceExport.dbService.getDb() as DbType

      let handle!: JobHandle
      db.transaction(
        (tx) => {
          // Companion "business write" in the same tx — a terminal dummy row.
          tx.insert(jobTable)
            .values({
              type: 'tx.task',
              status: 'completed',
              queue: 'biz',
              scheduledAt: Date.now(),
              input: {},
              maxAttempts: 1
            })
            .run()
          handle = jobManager.enqueueTx(tx, 'tx.task' as never, { message: 'atomic' } as never)
        },
        { behavior: 'immediate' }
      )

      const settled = await handle.finished
      expect(settled.status).toBe('completed')
      // Both writes of the tx are visible.
      expect(jobService.count({ queue: 'biz' })).toBe(1)

      await drainAllQueues(jobManager)
      await teardownManager(scheduler, jobManager)
    })

    it('rolls back the job row with the caller transaction — no dispatch, no resolver leak', async () => {
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['tx.rollback', makeSlowHandler('abandon') as JobHandler]]
      })
      const db = MockMainDbServiceExport.dbService.getDb() as DbType
      const resolvers = (jobManager as unknown as { finishedResolvers: Map<string, unknown> }).finishedResolvers

      let jobId = ''
      expect(() =>
        db.transaction(
          (tx) => {
            const handle = jobManager.enqueueTx(tx, 'tx.rollback' as never, { message: 'doomed' } as never)
            jobId = handle.id
            expect(resolvers.has(jobId)).toBe(true) // registered inside the tx
            throw new Error('business-write-failed')
          },
          { behavior: 'immediate' }
        )
      ).toThrow('business-write-failed')

      // Let the deferred post-commit microtask observe the rollback and clean up.
      await new Promise((r) => setTimeout(r, 0))

      expect(jobService.getById(jobId)).toBeNull()
      expect(resolvers.has(jobId)).toBe(false)
      expect(jobService.count({ type: 'tx.rollback' })).toBe(0)

      await drainAllQueues(jobManager)
      await teardownManager(scheduler, jobManager)
    })

    it('returns the existing handle on an idempotency hit inside the tx — no new row', async () => {
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['tx.idem', makeSlowHandler('abandon') as JobHandler]]
      })
      const db = MockMainDbServiceExport.dbService.getDb() as DbType

      const first = jobManager.enqueue(
        'tx.idem' as never,
        { message: 'one', sleepMs: 300 } as never,
        {
          idempotencyKey: 'tx-idem-key'
        } as never
      )

      let second!: JobHandle
      db.transaction(
        (tx) => {
          second = jobManager.enqueueTx(
            tx,
            'tx.idem' as never,
            { message: 'two' } as never,
            {
              idempotencyKey: 'tx-idem-key'
            } as never
          )
        },
        { behavior: 'immediate' }
      )

      expect(second.id).toBe(first.id)
      expect(jobService.count({ type: 'tx.idem' })).toBe(1)

      await first.finished
      await drainAllQueues(jobManager)
      await teardownManager(scheduler, jobManager)
    })

    it('arms a delayed job after commit and promotes it at scheduledAt', async () => {
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['tx.delayed', makeSlowHandler('abandon') as JobHandler]]
      })
      const db = MockMainDbServiceExport.dbService.getDb() as DbType

      let handle!: JobHandle
      db.transaction(
        (tx) => {
          handle = jobManager.enqueueTx(
            tx,
            'tx.delayed' as never,
            { message: 'later', sleepMs: 5 } as never,
            {
              scheduledAt: Date.now() + 150
            } as never
          )
        },
        { behavior: 'immediate' }
      )

      expect(handle.snapshot.status).toBe('delayed')

      const settled = await handle.finished
      expect(settled.status).toBe('completed')

      await drainAllQueues(jobManager)
      await teardownManager(scheduler, jobManager)
    })

    it.each(['enqueue', 'enqueueTx'] as const)(
      'rejects an empty idempotency key through %s before persistence',
      async (method) => {
        const { scheduler, jobManager } = await bootstrapManager({
          handlers: [['empty.key', makeSlowHandler('abandon') as JobHandler]]
        })
        const db = MockMainDbServiceExport.dbService.getDb() as DbType

        let thrown: unknown
        try {
          if (method === 'enqueue') {
            jobManager.enqueue('empty.key' as never, {} as never, { idempotencyKey: '' })
          } else {
            jobManager.enqueueTx(db, 'empty.key' as never, {} as never, { idempotencyKey: '' })
          }
        } catch (error) {
          thrown = error
        }

        expect(thrown).toMatchObject({ code: 'JOB_INVALID_IDEMPOTENCY_KEY' })
        expect(jobService.count({ type: 'empty.key' })).toBe(0)
        expect((jobManager as unknown as { queues: Map<string, unknown> }).queues.size).toBe(0)
        expect((jobManager as unknown as { finishedResolvers: Map<string, unknown> }).finishedResolvers.size).toBe(0)

        await teardownManager(scheduler, jobManager)
      }
    )

    it('aggregates an empty idempotency key through enqueueBatchTx before persistence', async () => {
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['batch.tx-validation', makeSlowHandler('abandon') as JobHandler]]
      })
      const db = MockMainDbServiceExport.dbService.getDb() as DbType

      let thrown: unknown
      try {
        jobManager.enqueueBatchTx(
          db,
          'batch.tx-validation' as never,
          [{ input: { message: 'empty-key' }, options: { idempotencyKey: '' } }] as never
        )
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(EnqueueBatchValidationError)
      expect((thrown as EnqueueBatchValidationError).failures).toMatchObject([
        { index: 0, code: 'JOB_INVALID_IDEMPOTENCY_KEY' }
      ])
      expect(jobService.count({ type: 'batch.tx-validation' })).toBe(0)

      await teardownManager(scheduler, jobManager)
    })
  })

  describe('enqueueBatch', () => {
    it('treats an empty batch as a no-op', async () => {
      const { scheduler, jobManager } = await bootstrapManager()
      const dbService = MockMainDbServiceExport.dbService
      const cache = MockMainCacheServiceExport.cacheService
      dbService.withWriteTx.mockClear()
      cache.setSharedMany.mockClear()

      expect(jobManager.enqueueBatch('unregistered.empty' as never, [])).toEqual([])
      expect(dbService.withWriteTx).not.toHaveBeenCalled()
      expect(cache.setSharedMany).not.toHaveBeenCalled()

      await teardownManager(scheduler, jobManager)
    })

    it('aggregates validation failures before persistence or side effects', async () => {
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['batch.validation', makeSlowHandler('abandon') as JobHandler]]
      })
      const cache = MockMainCacheServiceExport.cacheService
      cache.setSharedMany.mockClear()

      let thrown: unknown
      try {
        jobManager.enqueueBatch(
          'batch.validation' as never,
          [
            { input: { message: 'bad-attempts' }, options: { maxAttempts: 0 } },
            { input: { message: 'empty-key' }, options: { idempotencyKey: '' } },
            { input: { message: 'bad-timeout' }, options: { timeoutMs: 0 } }
          ] as never
        )
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(EnqueueBatchValidationError)
      expect((thrown as EnqueueBatchValidationError).failures.map(({ index, code }) => ({ index, code }))).toEqual([
        { index: 0, code: 'JOB_INVALID_MAX_ATTEMPTS' },
        { index: 1, code: 'JOB_INVALID_IDEMPOTENCY_KEY' },
        { index: 2, code: 'JOB_INVALID_TIMEOUT_MS' }
      ])
      expect(jobService.count({ type: 'batch.validation' })).toBe(0)
      expect(cache.setSharedMany).not.toHaveBeenCalled()
      expect((jobManager as unknown as { queues: Map<string, unknown> }).queues.size).toBe(0)
      expect((jobManager as unknown as { finishedResolvers: Map<string, unknown> }).finishedResolvers.size).toBe(0)

      await teardownManager(scheduler, jobManager)
    })

    it('atomically admits 2,500 jobs, preserves order, and coalesces queue kicks and publication', async () => {
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['batch.large', makeSlowHandler('retry') as JobHandler]]
      })
      jobManager.pause('hold large admission at rest')
      const dispatch = vi.spyOn(jobManager, 'dispatch')
      const cache = MockMainCacheServiceExport.cacheService
      const dbService = MockMainDbServiceExport.dbService
      const db = dbService.getDb() as DbType
      cache.setSharedMany.mockClear()
      dbService.withWriteTx.mockClear()
      dbService.withWriteTx.mockImplementationOnce((fn) => db.transaction(fn as never, { behavior: 'immediate' }))

      const entries = Array.from({ length: 2_500 }, (_, index) => ({
        input: { message: `job-${index}` },
        options: { queue: index % 2 === 0 ? 'batch.q-a' : 'batch.q-b' }
      }))
      const handles = jobManager.enqueueBatch('batch.large' as never, entries as never)
      await Promise.resolve()

      expect(handles).toHaveLength(entries.length)
      expect(handles.map((handle) => (handle.snapshot.input as SlowInput).message)).toEqual(
        entries.map((entry) => entry.input.message)
      )
      expect(jobService.count({ type: 'batch.large' })).toBe(entries.length)
      expect(dbService.withWriteTx).toHaveBeenCalledTimes(1)
      expect(cache.setSharedMany).toHaveBeenCalledTimes(1)
      expect(cache.setSharedMany.mock.calls[0][0]).toHaveLength(entries.length)
      expect(dispatch.mock.calls.map(([queue]) => queue).sort()).toEqual(['batch.q-a', 'batch.q-b'])

      await teardownManager(scheduler, jobManager)
    })

    it('rolls back earlier insert chunks when public enqueueBatch fails in a later chunk', async () => {
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['batch.public-rollback', makeSlowHandler('abandon') as JobHandler]]
      })
      const dbService = MockMainDbServiceExport.dbService
      const db = dbService.getDb() as DbType
      const cache = MockMainCacheServiceExport.cacheService
      const dispatch = vi.spyOn(jobManager, 'dispatch')
      dbService.withWriteTx.mockClear()
      cache.setSharedMany.mockClear()
      dbService.withWriteTx.mockImplementationOnce((fn) => db.transaction(fn as never, { behavior: 'immediate' }))

      const entries = Array.from({ length: 125 }, (_, index) => ({
        input: { message: `job-${index}` },
        options: index === 75 ? { parentId: '00000000-0000-0000-0000-000000000000' } : undefined
      }))

      expect(() => jobManager.enqueueBatch('batch.public-rollback' as never, entries as never)).toThrow()

      expect(dbService.withWriteTx).toHaveBeenCalledTimes(1)
      expect(jobService.count({ type: 'batch.public-rollback' })).toBe(0)
      expect(cache.setSharedMany).not.toHaveBeenCalled()
      expect((jobManager as unknown as { queues: Map<string, unknown> }).queues.size).toBe(0)
      expect((jobManager as unknown as { finishedResolvers: Map<string, unknown> }).finishedResolvers.size).toBe(0)
      expect(dispatch).not.toHaveBeenCalled()

      await teardownManager(scheduler, jobManager)
    })

    it('continues dispatching when batch state publication fails', async () => {
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['batch.cache-failure', makeSlowHandler('abandon') as JobHandler]]
      })
      const cache = MockMainCacheServiceExport.cacheService
      cache.setSharedMany.mockImplementationOnce(() => {
        throw new Error('cache unavailable')
      })

      const handles = jobManager.enqueueBatch(
        'batch.cache-failure' as never,
        [{ input: { message: 'one', sleepMs: 5 } }, { input: { message: 'two', sleepMs: 5 } }] as never
      )
      const settled = await Promise.all(handles.map((handle) => handle.finished))

      expect(settled.map((snapshot) => snapshot.status)).toEqual(['completed', 'completed'])

      await drainAllQueues(jobManager)
      await teardownManager(scheduler, jobManager)
    })

    it('isolates delayed timer failures and still kicks every pending queue', async () => {
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['batch.timer-failure', makeSlowHandler('abandon') as JobHandler]]
      })
      const registerSchedule = vi.spyOn(scheduler, 'registerSchedule')
      registerSchedule.mockImplementationOnce(() => {
        throw new Error('timer registration failed')
      })
      const scheduledAt = Date.now() + 50

      const handles = jobManager.enqueueBatch(
        'batch.timer-failure' as never,
        [
          { input: { message: 'delayed-one', sleepMs: 5 }, options: { scheduledAt } },
          { input: { message: 'delayed-two', sleepMs: 5 }, options: { scheduledAt } },
          { input: { message: 'pending', sleepMs: 5 } }
        ] as never
      )
      const settled = await Promise.all(handles.map((handle) => handle.finished))

      expect(registerSchedule).toHaveBeenCalledTimes(2)
      expect(settled.map((snapshot) => snapshot.status)).toEqual(['completed', 'completed', 'completed'])

      await drainAllQueues(jobManager)
      await teardownManager(scheduler, jobManager)
    })

    it('skips full snapshot publication when the aggregate IPC budget is exceeded', async () => {
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['batch.large-payload', makeSlowHandler('abandon') as JobHandler]]
      })
      jobManager.pause('hold oversized publication at rest')
      const cache = MockMainCacheServiceExport.cacheService
      cache.setSharedMany.mockClear()

      const entries = Array.from({ length: 100 }, (_, index) => ({
        input: { message: `${index}:${'x'.repeat(50_000)}` }
      }))
      const handles = jobManager.enqueueBatch('batch.large-payload' as never, entries as never)
      await Promise.resolve()

      expect(handles).toHaveLength(entries.length)
      expect(jobService.count({ type: 'batch.large-payload' })).toBe(entries.length)
      expect(cache.setSharedMany).not.toHaveBeenCalled()

      await teardownManager(scheduler, jobManager)
    })

    it('reuses database and in-batch idempotency matches in input order', async () => {
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['batch.idempotency', makeSlowHandler('abandon') as JobHandler]]
      })
      jobManager.pause('hold idempotency batch at rest')
      const existing = jobManager.enqueue('batch.idempotency' as never, { message: 'existing' } as never, {
        idempotencyKey: 'existing-key'
      })
      const cache = MockMainCacheServiceExport.cacheService
      cache.setSharedMany.mockClear()

      const handles = jobManager.enqueueBatch(
        'batch.idempotency' as never,
        [
          { input: { message: 'existing-request' }, options: { idempotencyKey: 'existing-key' } },
          { input: { message: 'new-first' }, options: { idempotencyKey: 'new-key' } },
          { input: { message: 'new-duplicate' }, options: { idempotencyKey: 'new-key' } },
          { input: { message: 'unkeyed' } }
        ] as never
      )
      await Promise.resolve()

      expect(handles[0].id).toBe(existing.id)
      expect(handles[0].finished).toBe(existing.finished)
      expect(handles[1].id).toBe(handles[2].id)
      expect(handles[1].finished).toBe(handles[2].finished)
      expect((handles[1].snapshot.input as SlowInput).message).toBe('new-first')
      expect(jobService.count({ type: 'batch.idempotency' })).toBe(3)
      expect(cache.setSharedMany.mock.calls[0][0]).toHaveLength(2)

      await teardownManager(scheduler, jobManager)
    })

    it('rolls back every chunk without leaking resolvers, queues, publication, or dispatch', async () => {
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['batch.rollback', makeSlowHandler('abandon') as JobHandler]]
      })
      const db = MockMainDbServiceExport.dbService.getDb() as DbType
      const cache = MockMainCacheServiceExport.cacheService
      const dispatch = vi.spyOn(jobManager, 'dispatch')
      cache.setSharedMany.mockClear()
      let ids: string[] = []

      expect(() =>
        db.transaction(
          (tx) => {
            ids = jobManager
              .enqueueBatchTx(
                tx,
                'batch.rollback' as never,
                Array.from({ length: 125 }, (_, index) => ({ input: { message: `doomed-${index}` } })) as never
              )
              .map((handle) => handle.id)
            throw new Error('business-write-failed')
          },
          { behavior: 'immediate' }
        )
      ).toThrow('business-write-failed')
      await new Promise((resolve) => setTimeout(resolve, 0))

      const resolvers = (jobManager as unknown as { finishedResolvers: Map<string, unknown> }).finishedResolvers
      expect(jobService.count({ type: 'batch.rollback' })).toBe(0)
      expect(ids.every((id) => !resolvers.has(id))).toBe(true)
      expect((jobManager as unknown as { queues: Map<string, unknown> }).queues.size).toBe(0)
      expect(cache.setSharedMany).not.toHaveBeenCalled()
      expect(dispatch).not.toHaveBeenCalled()

      await teardownManager(scheduler, jobManager)
    })

    it('keeps existing per-queue and global running concurrency while draining a batch', async () => {
      let globalRunning = 0
      let maxGlobalRunning = 0
      const runningByQueue = new Map<string, number>()
      const maxByQueue = new Map<string, number>()
      const handler: JobHandler<{ message: string; queue: string }> = {
        recovery: 'retry',
        defaultQueue: (input) => input.queue,
        defaultConcurrency: 2,
        async execute(ctx) {
          globalRunning += 1
          maxGlobalRunning = Math.max(maxGlobalRunning, globalRunning)
          const queueRunning = (runningByQueue.get(ctx.input.queue) ?? 0) + 1
          runningByQueue.set(ctx.input.queue, queueRunning)
          maxByQueue.set(ctx.input.queue, Math.max(maxByQueue.get(ctx.input.queue) ?? 0, queueRunning))
          await new Promise((resolve) => setTimeout(resolve, 20))
          globalRunning -= 1
          runningByQueue.set(ctx.input.queue, queueRunning - 1)
          return ctx.input.message
        }
      }
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['batch.concurrency', handler as JobHandler]]
      })
      ;(jobManager as unknown as { globalMaxConcurrency: number }).globalMaxConcurrency = 3

      const handles = jobManager.enqueueBatch(
        'batch.concurrency' as never,
        Array.from({ length: 12 }, (_, index) => ({
          input: { message: `job-${index}`, queue: index % 2 === 0 ? 'queue-a' : 'queue-b' }
        })) as never
      )
      await Promise.all(handles.map((handle) => handle.finished))

      expect(maxGlobalRunning).toBeLessThanOrEqual(3)
      expect(maxByQueue.get('queue-a')).toBeLessThanOrEqual(2)
      expect(maxByQueue.get('queue-b')).toBeLessThanOrEqual(2)

      await drainAllQueues(jobManager)
      await teardownManager(scheduler, jobManager)
    })

    it('arms delayed batch rows after commit and allows pending and delayed cancellation', async () => {
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['batch.cancel', makeSlowHandler('retry') as JobHandler]]
      })
      jobManager.pause('keep cancellation targets at rest')
      const handles = jobManager.enqueueBatch(
        'batch.cancel' as never,
        [
          { input: { message: 'pending' } },
          { input: { message: 'delayed' }, options: { scheduledAt: Date.now() + 60_000 } }
        ] as never
      )
      await Promise.resolve()

      expect(jobService.getById(handles[0].id)?.status).toBe('pending')
      expect(jobService.getById(handles[1].id)?.status).toBe('delayed')
      await Promise.all(handles.map((handle) => jobManager.cancel(handle.id, 'cancel batch')))
      const settled = await Promise.all(handles.map((handle) => handle.finished))
      expect(settled.map((snapshot) => snapshot.status)).toEqual(['cancelled', 'cancelled'])

      await teardownManager(scheduler, jobManager)
    })

    it('promotes and completes delayed batch rows through the existing scheduler path', async () => {
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['batch.delayed', makeSlowHandler('retry') as JobHandler]]
      })
      const scheduledAt = Date.now() + 100
      const handles = jobManager.enqueueBatch(
        'batch.delayed' as never,
        [
          { input: { message: 'later-a', sleepMs: 5 }, options: { scheduledAt } },
          { input: { message: 'later-b', sleepMs: 5 }, options: { scheduledAt } }
        ] as never
      )

      expect(handles.every((handle) => handle.snapshot.status === 'delayed')).toBe(true)
      const settled = await Promise.all(handles.map((handle) => handle.finished))
      expect(settled.every((snapshot) => snapshot.status === 'completed')).toBe(true)

      await drainAllQueues(jobManager)
      await teardownManager(scheduler, jobManager)
    })

    it('recovers pending batch rows after restart and processes them normally', async () => {
      const first = await bootstrapManager({
        handlers: [['batch.recovery', makeSlowHandler('retry') as JobHandler]]
      })
      first.jobManager.pause('simulate shutdown before dispatch')
      const handles = first.jobManager.enqueueBatch(
        'batch.recovery' as never,
        Array.from({ length: 3 }, (_, index) => ({ input: { message: `recover-${index}`, sleepMs: 5 } })) as never
      )
      await Promise.resolve()
      expect(handles.every((handle) => jobService.getById(handle.id)?.status === 'pending')).toBe(true)
      await teardownManager(first.scheduler, first.jobManager)

      const second = await bootstrapManager({
        handlers: [['batch.recovery', makeSlowHandler('retry') as JobHandler]]
      })
      expect(jobService.list({ type: 'batch.recovery' }).every((snapshot) => snapshot.status === 'completed')).toBe(
        true
      )

      await drainAllQueues(second.jobManager)
      await teardownManager(second.scheduler, second.jobManager)
    })
  })

  describe('delayed promotion re-arm on early once-fire', () => {
    // The once-timer elapses on the monotonic clock while promoteDelayedDue
    // compares scheduledAt <= Date.now() on the wall clock; the domains round
    // to whole ms independently, so a fire can land with Date.now() still 1ms
    // short of scheduledAt and promote nothing (measured locally at ~0.4% of
    // fires). These tests pin the miss deterministically by no-oping the FIRST
    // promotion pass; the job must still complete via a re-armed second pass.
    it('re-arms the delayed-job promotion when the first fire misses', async () => {
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['tx.delayed.skew', makeSlowHandler('abandon') as JobHandler]]
      })
      const db = MockMainDbServiceExport.dbService.getDb() as DbType

      const promoteSpy = vi.spyOn(jobService, 'promoteDelayedDue')
      promoteSpy.mockImplementationOnce(() => 0)

      let handle!: JobHandle
      db.transaction(
        (tx) => {
          handle = jobManager.enqueueTx(
            tx,
            'tx.delayed.skew' as never,
            { message: 'later', sleepMs: 5 } as never,
            {
              scheduledAt: Date.now() + 50
            } as never
          )
        },
        { behavior: 'immediate' }
      )

      const settled = await handle.finished
      expect(settled.status).toBe('completed')
      // The mocked miss must have been followed by a real promotion pass.
      expect(promoteSpy.mock.calls.length).toBeGreaterThanOrEqual(2)

      promoteSpy.mockRestore()
      await drainAllQueues(jobManager)
      await teardownManager(scheduler, jobManager)
    })

    it('re-arms the retry promotion when the first fire misses', async () => {
      let attempts = 0
      const handler: JobHandler = {
        recovery: 'retry',
        cancelTimeoutMs: 500,
        defaultConcurrency: 2,
        defaultRetryPolicy: { maxAttempts: 2, backoff: 'fixed', baseDelayMs: 50, maxDelayMs: 50 },
        async execute() {
          attempts++
          if (attempts === 1) throw new Error('first-attempt-fails')
          return { echoed: 'recovered' }
        }
      }
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['retry.skew.task', handler]]
      })

      const promoteSpy = vi.spyOn(jobService, 'promoteDelayedDue')
      promoteSpy.mockImplementationOnce(() => 0)

      const handle = jobManager.enqueue('retry.skew.task' as never, { message: 'flaky-once' } as never)

      const settled = await handle.finished
      expect(settled.status).toBe('completed')
      expect(attempts).toBe(2)
      expect(promoteSpy.mock.calls.length).toBeGreaterThanOrEqual(2)

      promoteSpy.mockRestore()
      await drainAllQueues(jobManager)
      await teardownManager(scheduler, jobManager)
    })
  })
})
