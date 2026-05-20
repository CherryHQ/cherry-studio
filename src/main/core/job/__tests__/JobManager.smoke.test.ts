/**
 * End-to-end smoke test for the Job/Scheduler backbone (Phase 1 Step 18).
 *
 * Exercises a real DB via setupTestDatabase + a real SchedulerService + a real
 * JobManager wired through the standard mock @application factory (DbService
 * and CacheService come from the unified mock; SchedulerService and JobManager
 * are added in beforeAll). Verifies enqueue → running → progress → completed
 * as well as in-flight cancel and idempotencyKey reuse.
 *
 * Restart-recovery scenarios (abandon / retry / singleton) live in Step 19's
 * integration tests, not here.
 */

import { application } from '@application'
import { jobService } from '@data/services/JobService'
import { JobManager } from '@main/core/job/JobManager'
import type { JobHandler } from '@main/core/job/types'
import { JOB_PROGRESS_KEY_PREFIX, JOB_STATE_KEY_PREFIX } from '@main/core/job/types'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { SchedulerService } from '@main/core/scheduler/SchedulerService'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainCacheServiceExport, MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { MockMainDbServiceExport } from '@test-mocks/main/DbService'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { drainTrailingDispatch as drainHelper } from './_helpers'

vi.mock('@application', async () => {
  const mod = await import('@test-mocks/main/application')
  return mod.mockApplicationFactory()
})

interface EchoInput {
  message: string
  /** Optional sleep before resolving, used to give cancel() time to abort mid-flight. */
  sleepMs?: number
}

interface EchoOutput {
  echoed: string
}

let scheduler: SchedulerService
let jobManager: JobManager

function makeEchoHandler(): JobHandler<EchoInput> {
  return {
    recovery: 'abandon',
    cancelTimeoutMs: 2000,
    defaultConcurrency: 2,
    async execute(ctx) {
      ctx.reportProgress(25, { stage: 'starting' })
      const delay = ctx.input.sleepMs ?? 30
      await new Promise<void>((resolve, reject) => {
        if (ctx.signal.aborted) {
          reject(new Error('AbortError'))
          return
        }
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
      ctx.reportProgress(100, { stage: 'done' })
      return { echoed: `echo: ${ctx.input.message}` } satisfies EchoOutput
    }
  }
}

// Local thin alias so existing call sites stay short — implementation lives
// in __tests__/_helpers.ts and is shared with the integration suite.
async function drainTrailingDispatch(): Promise<void> {
  return drainHelper(jobManager)
}

describe('JobManager smoke (dummy.echo)', () => {
  setupTestDatabase()

  beforeAll(async () => {
    BaseService.resetInstances()
    scheduler = new SchedulerService()
    jobManager = new JobManager()

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

    await scheduler._doInit()
    await jobManager._doInit()
    jobManager.registerHandler('dummy.echo' as never, makeEchoHandler() as JobHandler)

    // Startup recovery moved to onAllReady behind a 60s wall-clock delay.
    // Skip the delay via fake timers — clearTimeout must be paired with
    // setTimeout, otherwise the timer queue keeps a dangling entry.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const allReadyPromise = jobManager._doAllReady()
    await vi.advanceTimersByTimeAsync(60_000)
    await allReadyPromise
    vi.useRealTimers()
  })

  afterAll(async () => {
    // Surface shutdown errors rather than swallowing them — a regression in
    // `_doStop` (e.g. cancel-timeout misclassified, dangling promise) should
    // fail the suite, not hide behind a silent catch.
    await jobManager._doStop()
    await scheduler._doStop()
    BaseService.resetInstances()
  })

  afterEach(async () => {
    await drainTrailingDispatch()
    MockMainCacheServiceUtils.resetMocks()
  })

  it('runs a job end-to-end (pending → running → completed)', async () => {
    const handle = await jobManager.enqueue('dummy.echo' as never, { message: 'hello' } as never)
    expect(handle.snapshot.status).toBe('pending')

    const settled = await handle.finished
    expect(settled.status).toBe('completed')
    expect(settled.output).toEqual({ echoed: 'echo: hello' })
    expect(settled.attempt).toBe(0)
    expect(settled.startedAt).not.toBeNull()
    expect(settled.finishedAt).not.toBeNull()
    expect(settled.error).toBeNull()
  })

  it('publishes state + progress through CacheService', async () => {
    const setShared = MockMainCacheServiceExport.cacheService.setShared

    const handle = await jobManager.enqueue('dummy.echo' as never, { message: 'progress' } as never)
    await handle.finished

    const stateKey = `${JOB_STATE_KEY_PREFIX}${handle.id}`
    const progressKey = `${JOB_PROGRESS_KEY_PREFIX}${handle.id}`

    const calls = setShared.mock.calls.map((c) => c[0])
    expect(calls).toContain(stateKey)
    expect(calls).toContain(progressKey)

    const progressCalls = setShared.mock.calls.filter((c) => c[0] === progressKey)
    expect(progressCalls.length).toBeGreaterThanOrEqual(2)
    expect(progressCalls[0][1]).toMatchObject({ progress: 25 })
    expect(progressCalls.at(-1)?.[1]).toMatchObject({ progress: 100 })
  })

  it('cancels an in-flight job', async () => {
    const handle = await jobManager.enqueue('dummy.echo' as never, { message: 'long', sleepMs: 500 } as never)
    // Wait for dispatch tx to fully commit before launching the next write.
    await drainTrailingDispatch()
    // Give the handler time to actually enter its abortable await.
    await new Promise((r) => setTimeout(r, 50))

    await jobManager.cancel(handle.id, 'user requested')
    const settled = await handle.finished

    expect(settled.status).toBe('cancelled')
    expect(settled.cancelRequested).toBe(true)
    expect(settled.error).toMatchObject({
      code: 'JOB_CANCELLED',
      retryable: false,
      message: expect.stringContaining('user requested')
    })
  })

  it('reuses an existing handle when idempotencyKey matches a non-terminal job', async () => {
    const key = `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const first = await jobManager.enqueue(
      'dummy.echo' as never,
      { message: 'unique', sleepMs: 500 } as never,
      { idempotencyKey: key } as never
    )
    await drainTrailingDispatch()
    const second = await jobManager.enqueue(
      'dummy.echo' as never,
      { message: 'unique', sleepMs: 500 } as never,
      { idempotencyKey: key } as never
    )

    expect(second.id).toBe(first.id)

    await drainTrailingDispatch()
    await new Promise((r) => setTimeout(r, 50))
    await jobManager.cancel(first.id)
    await first.finished
  })

  it('GETs jobs through JobService after enqueue', async () => {
    const handle = await jobManager.enqueue('dummy.echo' as never, { message: 'listed' } as never)
    await handle.finished
    await drainTrailingDispatch()

    const row = await jobService.getById(handle.id)
    expect(row).not.toBeNull()
    expect(row?.type).toBe('dummy.echo')
    expect(row?.status).toBe('completed')

    const all = await jobService.list({ type: 'dummy.echo' })
    expect(all.some((r) => r.id === handle.id)).toBe(true)
  })
})
