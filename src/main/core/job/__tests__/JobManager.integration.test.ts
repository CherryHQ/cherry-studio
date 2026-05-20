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

  // Startup recovery now lives in `onAllReady` behind a 60s wall-clock delay.
  // Fake setTimeout (and its paired clearTimeout — leaving clearTimeout real
  // leaks the fake-timer entry) so the delay collapses, then await both the
  // timer advance and the lifecycle hook promise.
  //
  // onAllReady resurrects queues for non-terminal rows and dispatchAll()
  // immediately claims them. The dispatch microtask chain runs *after*
  // await allReadyPromise resolves but *before* useRealTimers. If we switch
  // back to real timers at that moment, the handler's internal setTimeout
  // (registered as a fake timer while we're still in fake mode) gets
  // cancelled and the handler hangs forever. Drain the dispatch chain under
  // fake timers — advance generously so handler internal sleeps fire and
  // finalizeJob completes before we switch back.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const allReadyPromise = jobManager._doAllReady()
  await vi.advanceTimersByTimeAsync(60_000)
  await allReadyPromise
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

      // bootstrapManager already awaits _doAllReady() with fake timers.
      // Handler spawned outside dispatch mutex — drain + poll with explicit
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
})
