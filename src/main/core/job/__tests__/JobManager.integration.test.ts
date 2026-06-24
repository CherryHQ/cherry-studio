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
 *   - Layer 0 + Layer 1 mutex: multiple queues dispatching in parallel without
 *     libsql SQLITE_BUSY (regression guard for upstream issue #288)
 *
 * Note on scope: retry / singleton cases assert the full recovery →
 * resurrect → dispatch → completed chain. The terminal assertion is load-
 * bearing — without queue resurrection the row would stay pending forever
 * on cold start, so reaching completed is the actual contract these tests
 * enforce.
 */

import { application } from '@application'
import { jobTable } from '@data/db/schemas/job'
import type { DbType } from '@data/db/types'
import { jobService } from '@data/services/JobService'
import { JobManager } from '@main/core/job/JobManager'
import type { JobHandler } from '@main/core/job/types'
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
  await vi.advanceTimersByTimeAsync(60_000)
  await (jobManager as unknown as { _recoveryDone?: Promise<void> })._recoveryDone
  for (let i = 0; i < 5; i++) {
    await vi.advanceTimersByTimeAsync(100)
  }
  vi.useRealTimers()
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

      const all = await jobService.list({ type: 'task.abandon' })
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
        const row = await jobService.getById(runningId)
        if (row && row.status !== 'pending' && row.status !== 'running') break
        await new Promise((r) => setTimeout(r, 20))
      }
      await drainAllQueues(jobManager)

      const finalRunning = await jobService.getById(runningId)
      expect(finalRunning?.status).toBe('completed')

      // delayed remains delayed until its scheduledAt arrives (+60s in future).
      const finalDelayed = await jobService.getById(delayedId)
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
      const handle = await jobManager.enqueue('inflight.guard' as never, { message: 'x' } as never)
      await drainAllQueues(jobManager)
      expect(executeCount).toBe(1)
      expect((await jobService.getById(handle.id))?.status).toBe('running')

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
      expect((await jobService.getById(handle.id))?.status).toBe('running')
      expect(executeCount).toBe(1)

      // Release the gate → the single execution finalizes the row once.
      releaseGate()
      const settled = await Promise.race([
        handle.finished,
        new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 1000))
      ])
      expect(settled).not.toBe('timeout')
      expect((settled as { status: string }).status).toBe('completed')
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
        const row = await jobService.getById(newerId)
        if (row && row.status !== 'pending' && row.status !== 'running') break
        await new Promise((r) => setTimeout(r, 20))
      }
      await drainAllQueues(jobManager)

      const finalOlder = await jobService.getById(olderId)
      const finalNewer = await jobService.getById(newerId)
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
        const row = await jobService.getById(inserted.id)
        if (row && row.status !== 'pending' && row.status !== 'running') break
        await new Promise((r) => setTimeout(r, 20))
      }
      await drainAllQueues(jobManager)

      const final = await jobService.getById(inserted.id)
      expect(final?.status).toBe('completed')
      expect(final?.output).toEqual({ echoed: 'echo: resurrected' })

      await teardownManager(scheduler, jobManager)
    })
  })

  describe('graceful shutdown', () => {
    it('aborts in-flight handlers and resolves the finished promise quickly', async () => {
      const { scheduler, jobManager } = await bootstrapManager({
        handlers: [['shutdown.slow', makeSlowHandler('retry') as JobHandler]]
      })

      const handle = await jobManager.enqueue(
        'shutdown.slow' as never,
        {
          message: 'long',
          sleepMs: 5000
        } as never
      )

      // Wait for dispatch + handler.execute to be inside its await.
      await drainAllQueues(jobManager)
      await new Promise<void>((r) => setTimeout(r, 50))

      const stopPromise = jobManager._doStop()
      const settled = await Promise.race([
        handle.finished,
        new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 1000))
      ])
      expect(settled).not.toBe('timeout')
      expect((settled as { status: string }).status).toBe('cancelled')

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
      const occupant = await jobManager.enqueue(
        'cap.task' as never,
        { message: 'occupant', sleepMs: 150 } as never,
        { queue: 'qB' } as never
      )
      await drainAllQueues(jobManager)

      // Queue qA is enqueued while the global cap is saturated → blocked pending,
      // even though qA's own per-queue slots are free.
      const starved = await jobManager.enqueue(
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
      const settled = await Promise.race([
        starved.finished,
        new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 2000))
      ])
      expect(settled).not.toBe('timeout')
      expect((settled as { status: string }).status).toBe('completed')

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
      const retrySpy = vi.spyOn(jobService, 'setDelayedRetryTx').mockImplementation(async () => {
        throw Object.assign(new Error('synthetic-corrupt'), { code: 'SQLITE_CORRUPT' })
      })

      const handle = await jobManager.enqueue(
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
        final = await jobService.getById(handle.id)
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
      const retrySpy = vi.spyOn(jobService, 'setDelayedRetryTx').mockImplementation(async () => {
        throw Object.assign(new Error('synthetic-corrupt'), { code: 'SQLITE_CORRUPT' })
      })
      const terminalSpy = vi.spyOn(jobService, 'setTerminalTx').mockImplementation(async () => {
        throw Object.assign(new Error('synthetic-corrupt-terminal'), { code: 'SQLITE_CORRUPT' })
      })

      await jobManager.enqueue(
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
})
