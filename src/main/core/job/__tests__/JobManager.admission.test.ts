import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { jobService } from '@data/services/JobService'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { SchedulerService } from '@main/core/scheduler/SchedulerService'
import type { Trigger } from '@shared/data/api/schemas/jobs'

import { JobManager } from '../JobManager'
import type { JobHandler } from '../types'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    PowerService: { preventSleep: () => ({ dispose() {} }) }
  } as Parameters<typeof mockApplicationFactory>[0])
})

describe('JobManager schedule admission', () => {
  setupTestDatabase()
  let jobs: JobManager
  let scheduler: SchedulerService
  let allowed: boolean
  let checkFails: boolean

  beforeEach(async () => {
    BaseService.resetInstances()
    vi.useFakeTimers()
    allowed = false
    checkFails = false
    scheduler = new SchedulerService()
    jobs = new JobManager()
    const container = application.getContainer()
    vi.spyOn(application, 'get').mockImplementation((name) => {
      if (name === 'JobManager') return jobs
      if (name === 'SchedulerService') return scheduler
      return container.get(name)
    })
    await scheduler._doInit()
    await jobs._doInit()
    const handler: JobHandler = {
      recovery: 'retry',
      canSchedule(input) {
        if ((input as { healthy?: boolean }).healthy) return true
        if (checkFails) throw new Error('read unavailable')
        return allowed
      },
      async execute(ctx) {
        return ctx.input
      }
    }
    jobs.registerHandler('test.admission' as never, handler)
  })

  afterEach(async () => {
    await jobs._doStop()
    await scheduler._doStop()
    vi.restoreAllMocks()
    vi.useRealTimers()
    BaseService.resetInstances()
  })

  function schedule(name: string, trigger: Trigger, healthy = false) {
    return jobs.registerJobSchedule({
      type: 'test.admission' as never,
      name,
      trigger,
      jobInputTemplate: { healthy } as never,
      catchUpPolicy: { kind: 'skip-missed' }
    })
  }

  it.each(['denied', 'unavailable'])(
    'retries a %s once fire without consuming it or blocking healthy work',
    async (mode) => {
      checkFails = mode === 'unavailable'
      const blocked = schedule('blocked', { kind: 'once', at: Date.now() + 100 })
      const healthy = schedule('healthy', { kind: 'once', at: Date.now() + 100 }, true)
      await vi.advanceTimersByTimeAsync(101)
      expect(jobService.list({ scheduleId: blocked.id })).toEqual([])
      expect(jobScheduleService.getById(blocked.id)?.lastRun).toBeNull()
      expect(jobService.list({ scheduleId: healthy.id })).toEqual([expect.objectContaining({ status: 'completed' })])

      allowed = true
      checkFails = false
      await vi.advanceTimersByTimeAsync(30_000)
      expect(jobService.list({ scheduleId: blocked.id })).toEqual([expect.objectContaining({ status: 'completed' })])
      expect(jobScheduleService.getById(blocked.id)?.lastRun).not.toBeNull()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(jobService.list({ scheduleId: blocked.id })).toHaveLength(1)
    }
  )

  it.each(['once', 'interval', 'cron'] as const)(
    'reports a blocked manual %s trigger without queuing a hidden retry',
    async (kind) => {
      const trigger: Trigger =
        kind === 'once'
          ? { kind, at: Date.now() + 3_600_000 }
          : kind === 'interval'
            ? { kind, ms: 3_600_000 }
            : { kind, expr: '0 0 1 1 *' }
      const row = schedule('manual', trigger)
      expect(await jobs.triggerJobScheduleNowById(row.id)).toBe(false)
      expect(jobService.list({ scheduleId: row.id })).toEqual([])
      expect(jobScheduleService.getById(row.id)?.lastRun).toBeNull()
      allowed = true
      await vi.advanceTimersByTimeAsync(30_000)
      expect(jobService.list({ scheduleId: row.id })).toEqual([])
      expect(await jobs.triggerJobScheduleNowById(row.id)).toBe(true)
      await vi.advanceTimersByTimeAsync(1)
      expect(jobService.list({ scheduleId: row.id })).toEqual([expect.objectContaining({ status: 'completed' })])
    }
  )

  it('rechecks a deferred startup catch-up using the current template', async () => {
    const row = jobScheduleService.create({
      type: 'test.admission',
      name: 'overdue',
      trigger: { kind: 'interval', ms: 3_600_000 },
      jobInputTemplate: { healthy: false },
      catchUpPolicy: { kind: 'after-startup', minutes: 0 }
    })
    jobScheduleService.setNextRun(row.id, Date.now() - 1)
    await jobs._doAllReady()
    await vi.advanceTimersByTimeAsync(60_001)
    expect(jobService.list({ scheduleId: row.id })).toEqual([])
    jobScheduleService.update(row.id, { jobInputTemplate: { healthy: true } })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(jobService.list({ scheduleId: row.id })).toEqual([
      expect.objectContaining({ status: 'completed', input: { healthy: true } })
    ])
    await vi.advanceTimersByTimeAsync(60_000)
    expect(jobService.list({ scheduleId: row.id })).toHaveLength(1)
  })

  it('keeps deferred once fires paused and drops deleted schedules', async () => {
    const retained = schedule('retained', { kind: 'once', at: Date.now() + 100 })
    const removed = schedule('removed', { kind: 'once', at: Date.now() + 100 })
    await vi.advanceTimersByTimeAsync(101)
    const hold = jobs.pause('test')
    allowed = true
    await jobs.unregisterJobScheduleById(removed.id)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(jobService.list({ type: 'test.admission' })).toEqual([])
    hold.dispose()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(jobService.list({ type: 'test.admission' })).toEqual([
      expect.objectContaining({ scheduleId: retained.id, status: 'completed' })
    ])
  })
  it('keeps a once fire retryable when reading its schedule fails', async () => {
    const row = schedule('read-failure', { kind: 'once', at: Date.now() + 100 })
    const read = vi.spyOn(jobScheduleService, 'getById').mockImplementationOnce(() => {
      throw new Error('read failed')
    })
    await vi.advanceTimersByTimeAsync(101)
    read.mockRestore()
    expect(jobService.list({ scheduleId: row.id })).toEqual([])
    expect(jobScheduleService.getById(row.id)?.lastRun).toBeNull()
    allowed = true
    await vi.advanceTimersByTimeAsync(30_000)
    expect(jobService.list({ scheduleId: row.id })).toEqual([expect.objectContaining({ status: 'completed' })])
  })

  it('does not replay a deferred occurrence after its trigger is replaced or disabled', async () => {
    const replaced = schedule('replaced', { kind: 'once', at: Date.now() + 100 })
    const disabled = schedule('disabled', { kind: 'once', at: Date.now() + 100 })
    await vi.advanceTimersByTimeAsync(101)
    allowed = true
    jobs.updateJobSchedule(replaced.id, { trigger: { kind: 'once', at: Date.now() + 120_000 } })
    jobs.updateJobSchedule(disabled.id, { enabled: false })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(jobService.list({ type: 'test.admission' })).toEqual([])
    await vi.advanceTimersByTimeAsync(90_001)
    expect(jobService.list({ type: 'test.admission' })).toEqual([
      expect.objectContaining({ scheduleId: replaced.id, status: 'completed' })
    ])
  })

  it('recovers an unconsumed deferred once fire after process restart', async () => {
    const row = schedule('restart', { kind: 'once', at: Date.now() + 100 })
    await vi.advanceTimersByTimeAsync(101)
    expect(jobService.list({ scheduleId: row.id })).toEqual([])
    await jobs._doStop()
    BaseService.resetInstances()
    jobs = new JobManager()
    await jobs._doInit()
    jobs.registerHandler('test.admission' as never, {
      recovery: 'retry',
      canSchedule: () => true,
      async execute() {
        return 'recovered'
      }
    })
    await jobs._doAllReady()
    await vi.advanceTimersByTimeAsync(60_001)
    expect(jobService.list({ scheduleId: row.id })).toEqual([
      expect.objectContaining({ status: 'completed', output: 'recovered' })
    ])
  })

  it('does not apply schedule admission to direct enqueue', async () => {
    const job = jobs.enqueue('test.admission' as never, { healthy: false } as never)
    await vi.advanceTimersByTimeAsync(1)
    expect(jobService.getById(job.id)?.status).toBe('completed')
  })

  it('retries a denied cron occurrence without duplicating it', async () => {
    vi.setSystemTime(new Date('2026-12-31T23:59:59Z'))
    const row = schedule('cron', { kind: 'cron', expr: '0 0 1 1 *', timezone: 'UTC' })
    await vi.advanceTimersByTimeAsync(1_001)
    expect(jobService.list({ scheduleId: row.id })).toEqual([])
    allowed = true
    await vi.advanceTimersByTimeAsync(30_000)
    expect(jobService.list({ scheduleId: row.id })).toEqual([expect.objectContaining({ status: 'completed' })])
    await vi.advanceTimersByTimeAsync(60_000)
    expect(jobService.list({ scheduleId: row.id })).toHaveLength(1)
  })
})
