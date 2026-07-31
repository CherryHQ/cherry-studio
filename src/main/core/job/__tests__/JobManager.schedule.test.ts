/**
 * Schedule-control unit tests (by-id / by-name APIs + updateJobSchedule branch coverage).
 *
 * Covers the public schedule APIs that the agent.task migration depends on:
 *   - by-id and by-name pause / resume / triggerNow / unregister
 *   - updateJobSchedule re-arm branch matrix
 *   - error-code surfacing for missing / ambiguous schedules
 *
 * These call paths are not exercised by the existing smoke or restart-recovery
 * suites — those focus on enqueue/dispatch/recovery rather than schedule
 * lifecycle CRUD.
 */

import { setupTestDatabase } from '@test-helpers/db'
import { MockMainCacheServiceExport } from '@test-mocks/main/CacheService'
import { MockMainDbServiceExport } from '@test-mocks/main/DbService'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { jobService } from '@data/services/JobService'
import { JobManager } from '@main/core/job/JobManager'
import type { JobHandler } from '@main/core/job/types'
import { BaseService } from '@main/core/lifecycle/BaseService'
import type { Disposable } from '@main/core/lifecycle/event'
import { SchedulerService } from '@main/core/scheduler/SchedulerService'
import type { Trigger } from '@shared/data/api/schemas/jobs'
import { JOB_ERROR_CODES } from '@shared/data/api/schemas/jobs'

// Locally augment JobRegistry so test payloads type-check. The dummy entry is
// removed from the JS surface after compile and never enters production code.
declare module '@main/core/job/jobRegistry' {
  interface JobRegistry {
    'dummy.echo': Record<string, unknown>
  }
}

vi.mock('@application', async () => {
  const mod = await import('@test-mocks/main/application')
  return mod.mockApplicationFactory()
})

const DUMMY_TYPE = 'dummy.echo' as const

function makeNoopHandler(): JobHandler {
  return {
    recovery: 'abandon',
    cancelTimeoutMs: 1000,
    defaultConcurrency: 1,
    async execute() {
      return {}
    }
  }
}

const baseTrigger: Trigger = { kind: 'interval', ms: 60_000 }
const altTrigger: Trigger = { kind: 'interval', ms: 30_000 }

function clearScheduleDisposables(jobManager: JobManager) {
  const map = (jobManager as unknown as { scheduleDisposables: Map<string, Disposable> }).scheduleDisposables
  for (const disp of map.values()) disp.dispose()
  map.clear()
}

async function waitForImmediateJobsToDrain() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const active = jobService.list({ status: ['pending', 'running'] })
    if (active.length === 0) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe('JobManager schedule control APIs', () => {
  const dbh = setupTestDatabase()
  let scheduler: SchedulerService
  let jobManager: JobManager

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
        case 'PowerService':
          return { preventSleep: () => ({ dispose: () => {} }) }
      }
      throw new Error(`Unexpected application.get('${name}')`)
    })

    jobManager.registerHandler(DUMMY_TYPE, makeNoopHandler())
    await scheduler._doInit()
    await jobManager._doInit()

    // `onAllReady` schedules startup recovery via setTimeout and returns
    // synchronously. Skip the 60s quiet window via fake timers, then await
    // `_recoveryDone` (set inside the timer callback) for the deferred flow.
    // `toFake` must pair setTimeout with clearTimeout.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    void jobManager._doAllReady()
    await vi.advanceTimersByTimeAsync(60_000)
    await (jobManager as unknown as { _recoveryDone?: Promise<void> })._recoveryDone
    vi.useRealTimers()
  })

  afterAll(async () => {
    await jobManager._doStop()
    await scheduler._doStop()
    BaseService.resetInstances()
  })

  // The schedule registry persists across tests via setupTestDatabase's
  // beforeEach truncate. After truncate, scheduleDisposables holds dangling
  // entries pointing at rows that no longer exist — clear them so each test
  // starts from a clean in-process state.
  // NOTE: do NOT call vi.restoreAllMocks() in afterEach — it would also
  // restore the application.get() mockImplementation set in beforeAll,
  // breaking subsequent tests. Each spy below uses .mockRestore() locally.
  beforeEach(() => {
    clearScheduleDisposables(jobManager)
  })

  afterEach(async () => {
    clearScheduleDisposables(jobManager)
    await waitForImmediateJobsToDrain()
  })

  // ----------------------------------------------------------------------
  // by-id family — found returns true, missing returns false (no throw)
  // ----------------------------------------------------------------------

  describe('by-id', () => {
    it('persists the next automatic fire as soon as cron, interval and once schedules are armed', () => {
      const cron = jobManager.registerJobSchedule({
        type: DUMMY_TYPE,
        name: 'next-cron',
        trigger: { kind: 'cron', expr: '0 0 1 1 *' },
        jobInputTemplate: {},
        catchUpPolicy: { kind: 'skip-missed' }
      })
      const beforeInterval = Date.now()
      const interval = jobManager.registerJobSchedule({
        type: DUMMY_TYPE,
        name: 'next-interval',
        trigger: baseTrigger,
        jobInputTemplate: {},
        catchUpPolicy: { kind: 'skip-missed' }
      })
      const onceAt = Date.now() + 120_000
      const once = jobManager.registerJobSchedule({
        type: DUMMY_TYPE,
        name: 'next-once',
        trigger: { kind: 'once', at: onceAt },
        jobInputTemplate: {},
        catchUpPolicy: { kind: 'skip-missed' }
      })

      expect(jobScheduleService.getById(cron.id)?.nextRun).not.toBeNull()
      const intervalNextRun = jobScheduleService.getById(interval.id)?.nextRun
      expect(intervalNextRun).not.toBeNull()
      expect(Date.parse(intervalNextRun ?? '')).toBeGreaterThanOrEqual(beforeInterval + 60_000)
      expect(jobScheduleService.getById(once.id)?.nextRun).toBe(new Date(onceAt).toISOString())
    })

    it('pauseJobScheduleById returns true for existing, false for missing', async () => {
      const snap = jobManager.registerJobSchedule({
        type: DUMMY_TYPE,
        trigger: baseTrigger,
        jobInputTemplate: {} as Record<string, unknown>,
        catchUpPolicy: { kind: 'skip-missed' }
      })

      expect(await jobManager.pauseJobScheduleById(snap.id)).toBe(true)
      expect(await jobManager.pauseJobScheduleById('does-not-exist')).toBe(false)
    })

    it('pause clears nextRun and resume computes a new automatic fire', async () => {
      const schedule = jobManager.registerJobSchedule({
        type: DUMMY_TYPE,
        name: 'pause-resume-next-run',
        trigger: baseTrigger,
        jobInputTemplate: {},
        catchUpPolicy: { kind: 'skip-missed' }
      })
      expect(jobScheduleService.getById(schedule.id)?.nextRun).not.toBeNull()

      await jobManager.pauseJobScheduleById(schedule.id)
      expect(jobScheduleService.getById(schedule.id)?.nextRun).toBeNull()

      expect(jobManager.resumeJobScheduleById(schedule.id)).toBe(true)
      expect(jobScheduleService.getById(schedule.id)?.nextRun).not.toBeNull()
    })

    it('resumeJobScheduleById returns true for existing, false for missing', async () => {
      const snap = jobManager.registerJobSchedule({
        type: DUMMY_TYPE,
        trigger: baseTrigger,
        jobInputTemplate: {} as Record<string, unknown>,
        catchUpPolicy: { kind: 'skip-missed' }
      })

      expect(jobManager.resumeJobScheduleById(snap.id)).toBe(true)
      expect(jobManager.resumeJobScheduleById('does-not-exist')).toBe(false)
    })

    it('unregisterJobScheduleById returns true for existing, false for missing', async () => {
      const snap = jobManager.registerJobSchedule({
        type: DUMMY_TYPE,
        trigger: baseTrigger,
        jobInputTemplate: {} as Record<string, unknown>,
        catchUpPolicy: { kind: 'skip-missed' }
      })

      expect(await jobManager.unregisterJobScheduleById(snap.id)).toBe(true)
      expect(await jobManager.unregisterJobScheduleById('does-not-exist')).toBe(false)
    })
  })

  // ----------------------------------------------------------------------
  // by-name family — resolves to by-id via resolveScheduleIdByName
  // ----------------------------------------------------------------------

  describe('by-name', () => {
    it('pauseJobSchedule(type, name) resolves and pauses', async () => {
      jobManager.registerJobSchedule({
        type: DUMMY_TYPE,
        name: 'nightly',
        trigger: baseTrigger,
        jobInputTemplate: {} as Record<string, unknown>,
        catchUpPolicy: { kind: 'skip-missed' }
      })

      expect(await jobManager.pauseJobSchedule(DUMMY_TYPE, 'nightly')).toBe(true)
    })

    it('resumeJobSchedule(type, name) resolves and resumes', async () => {
      jobManager.registerJobSchedule({
        type: DUMMY_TYPE,
        name: 'morning',
        trigger: baseTrigger,
        jobInputTemplate: {} as Record<string, unknown>,
        catchUpPolicy: { kind: 'skip-missed' }
      })

      expect(await jobManager.resumeJobSchedule(DUMMY_TYPE, 'morning')).toBe(true)
    })

    it('triggerJobScheduleNow(type, name) returns true for an armed cron-free schedule', async () => {
      jobManager.registerJobSchedule({
        type: DUMMY_TYPE,
        name: 'evening',
        trigger: baseTrigger,
        jobInputTemplate: {} as Record<string, unknown>,
        catchUpPolicy: { kind: 'skip-missed' }
      })

      expect(await jobManager.triggerJobScheduleNow(DUMMY_TYPE, 'evening')).toBe(true)
    })

    it('manual interval and early-once runs preserve their automatic fire', async () => {
      const interval = jobManager.registerJobSchedule({
        type: DUMMY_TYPE,
        name: 'manual-interval',
        trigger: baseTrigger,
        jobInputTemplate: {},
        catchUpPolicy: { kind: 'skip-missed' }
      })
      const onceAt = Date.now() + 120_000
      const once = jobManager.registerJobSchedule({
        type: DUMMY_TYPE,
        name: 'manual-once',
        trigger: { kind: 'once', at: onceAt },
        jobInputTemplate: {},
        catchUpPolicy: { kind: 'skip-missed' }
      })
      const intervalNextRun = jobScheduleService.getById(interval.id)?.nextRun
      const onceNextRun = jobScheduleService.getById(once.id)?.nextRun
      expect(intervalNextRun).not.toBeNull()
      expect(onceNextRun).not.toBeNull()

      expect(await jobManager.triggerJobScheduleNowById(interval.id)).toBe(true)
      expect(await jobManager.triggerJobScheduleNowById(once.id)).toBe(true)

      expect(jobScheduleService.getById(interval.id)).toMatchObject({ nextRun: intervalNextRun })
      expect(jobScheduleService.getById(once.id)).toMatchObject({ nextRun: onceNextRun })
      expect(jobScheduleService.getById(interval.id)?.lastRun).not.toBeNull()
      expect(jobScheduleService.getById(once.id)?.lastRun).not.toBeNull()
    })

    it('clears nextRun after a once schedule fires naturally', async () => {
      const onceAt = Date.now() + 10
      const schedule = jobManager.registerJobSchedule({
        type: DUMMY_TYPE,
        name: 'natural-once',
        trigger: { kind: 'once', at: onceAt },
        jobInputTemplate: {},
        catchUpPolicy: { kind: 'skip-missed' }
      })
      expect(jobScheduleService.getById(schedule.id)?.nextRun).toBe(new Date(onceAt).toISOString())

      await new Promise((resolve) => setTimeout(resolve, 40))

      expect(jobScheduleService.getById(schedule.id)).toMatchObject({ nextRun: null })
      expect(jobScheduleService.getById(schedule.id)?.lastRun).not.toBeNull()
    })

    it('advances persisted nextRun after an interval fires naturally', async () => {
      const schedule = jobManager.registerJobSchedule({
        type: DUMMY_TYPE,
        name: 'natural-interval',
        trigger: { kind: 'interval', ms: 20 },
        jobInputTemplate: {},
        catchUpPolicy: { kind: 'skip-missed' }
      })
      const initialNextRun = jobScheduleService.getById(schedule.id)?.nextRun
      expect(initialNextRun).not.toBeNull()

      await new Promise((resolve) => setTimeout(resolve, 30))

      const advancedNextRun = jobScheduleService.getById(schedule.id)?.nextRun
      // Bound against the fire cadence, not Date.now(): a stalled event loop
      // can let the interval fire again and leave the last write in the past.
      expect(Date.parse(advancedNextRun ?? '')).toBeGreaterThanOrEqual(Date.parse(initialNextRun ?? '') + 20)
    })

    it('unregisterJobSchedule(type, name) deletes the row', async () => {
      const snap = jobManager.registerJobSchedule({
        type: DUMMY_TYPE,
        name: 'to-delete',
        trigger: baseTrigger,
        jobInputTemplate: {} as Record<string, unknown>,
        catchUpPolicy: { kind: 'skip-missed' }
      })

      expect(await jobManager.unregisterJobSchedule(DUMMY_TYPE, 'to-delete')).toBe(true)
      expect(jobScheduleService.getById(snap.id)).toBeNull()
    })

    it('resolves the singleton when name is omitted on a single-schedule type', async () => {
      jobManager.registerJobSchedule({
        type: DUMMY_TYPE,
        trigger: baseTrigger,
        jobInputTemplate: {} as Record<string, unknown>,
        catchUpPolicy: { kind: 'skip-missed' }
      })

      expect(await jobManager.pauseJobSchedule(DUMMY_TYPE)).toBe(true)
    })

    it('throws SCHEDULE_NAME_REQUIRED when type has multiple schedules and name is omitted', async () => {
      jobManager.registerJobSchedule({
        type: DUMMY_TYPE,
        name: 'a',
        trigger: baseTrigger,
        jobInputTemplate: {} as Record<string, unknown>,
        catchUpPolicy: { kind: 'skip-missed' }
      })
      jobManager.registerJobSchedule({
        type: DUMMY_TYPE,
        name: 'b',
        trigger: baseTrigger,
        jobInputTemplate: {} as Record<string, unknown>,
        catchUpPolicy: { kind: 'skip-missed' }
      })

      await expect(jobManager.pauseJobSchedule(DUMMY_TYPE)).rejects.toThrow(JOB_ERROR_CODES.SCHEDULE_NAME_REQUIRED)
    })

    it('throws SCHEDULE_NOT_FOUND_BY_NAME when (type, name) does not exist', async () => {
      await expect(jobManager.pauseJobSchedule(DUMMY_TYPE, 'missing')).rejects.toThrow(
        JOB_ERROR_CODES.SCHEDULE_NOT_FOUND_BY_NAME
      )
    })
  })

  // ----------------------------------------------------------------------
  // updateJobSchedule — re-arm branch matrix
  // ----------------------------------------------------------------------

  describe('updateJobSchedule', () => {
    function getScheduleDisposables(): Map<string, Disposable> {
      return (jobManager as unknown as { scheduleDisposables: Map<string, Disposable> }).scheduleDisposables
    }

    it('(a) trigger-only + enabled stays true: re-arms once', async () => {
      const snap = jobManager.registerJobSchedule({
        type: DUMMY_TYPE,
        name: 'case-a',
        trigger: baseTrigger,
        jobInputTemplate: {} as Record<string, unknown>,
        catchUpPolicy: { kind: 'skip-missed' }
      })
      const armSpy = vi.spyOn(jobManager as unknown as { armSchedule: (s: unknown) => void }, 'armSchedule')

      const updated = jobManager.updateJobSchedule(snap.id, { trigger: altTrigger })

      expect(updated?.enabled).toBe(true)
      expect(armSpy).toHaveBeenCalledTimes(1)
      expect(updated?.nextRun).not.toBeNull()
      expect(Date.parse(updated?.nextRun ?? '')).toBeLessThanOrEqual(Date.now() + 30_000)
    })

    it('(b) trigger + enabled false: disposes and does not re-arm', async () => {
      const snap = jobManager.registerJobSchedule({
        type: DUMMY_TYPE,
        name: 'case-b',
        trigger: baseTrigger,
        jobInputTemplate: {} as Record<string, unknown>,
        catchUpPolicy: { kind: 'skip-missed' }
      })
      const armSpy = vi.spyOn(jobManager as unknown as { armSchedule: (s: unknown) => void }, 'armSchedule')

      const updated = jobManager.updateJobSchedule(snap.id, { trigger: altTrigger, enabled: false })

      expect(updated?.enabled).toBe(false)
      expect(armSpy).not.toHaveBeenCalled()
      expect(getScheduleDisposables().has(snap.id)).toBe(false)
    })

    it('(c) enabled-only false→true: re-arms', async () => {
      const snap = jobManager.registerJobSchedule({
        type: DUMMY_TYPE,
        name: 'case-c',
        trigger: baseTrigger,
        jobInputTemplate: {} as Record<string, unknown>,
        catchUpPolicy: { kind: 'skip-missed' }
      })
      // Disable first; this disposes the in-process entry but keeps the row.
      jobManager.updateJobSchedule(snap.id, { enabled: false })
      expect(getScheduleDisposables().has(snap.id)).toBe(false)

      const armSpy = vi.spyOn(jobManager as unknown as { armSchedule: (s: unknown) => void }, 'armSchedule')
      const updated = jobManager.updateJobSchedule(snap.id, { enabled: true })

      expect(updated?.enabled).toBe(true)
      expect(armSpy).toHaveBeenCalledTimes(1)
    })

    it('(d) enabled-only true→false: disposes', async () => {
      const snap = jobManager.registerJobSchedule({
        type: DUMMY_TYPE,
        name: 'case-d',
        trigger: baseTrigger,
        jobInputTemplate: {} as Record<string, unknown>,
        catchUpPolicy: { kind: 'skip-missed' }
      })
      expect(getScheduleDisposables().has(snap.id)).toBe(true)

      const updated = jobManager.updateJobSchedule(snap.id, { enabled: false })

      expect(updated?.enabled).toBe(false)
      expect(getScheduleDisposables().has(snap.id)).toBe(false)
    })

    it('(e) jobInputTemplate update does not re-arm and the existing cron uses the latest template', async () => {
      const snap = jobManager.registerJobSchedule({
        type: DUMMY_TYPE,
        name: 'case-e',
        trigger: { kind: 'cron', expr: '0 0 1 1 *' },
        jobInputTemplate: { prompt: 'old prompt', workspace: 'old workspace' },
        catchUpPolicy: { kind: 'skip-missed' }
      })
      const originalDisp = getScheduleDisposables().get(snap.id)
      const armSpy = vi.spyOn(jobManager as unknown as { armSchedule: (s: unknown) => void }, 'armSchedule')

      const latestTemplate = { prompt: 'new prompt', workspace: 'new workspace' }
      const updated = jobManager.updateJobSchedule(snap.id, { jobInputTemplate: latestTemplate })

      expect(updated?.jobInputTemplate).toEqual(latestTemplate)
      expect(armSpy).not.toHaveBeenCalled()
      expect(getScheduleDisposables().get(snap.id)).toBe(originalDisp)

      expect(await jobManager.triggerJobScheduleNowById(snap.id)).toBe(true)
      expect(jobService.list({ scheduleId: snap.id })).toEqual([expect.objectContaining({ input: latestTemplate })])
    })

    it('keeps an interval timer armed while its next automatic fire reads the latest template', async () => {
      const snap = jobManager.registerJobSchedule({
        type: DUMMY_TYPE,
        name: 'interval-latest-template',
        trigger: baseTrigger,
        jobInputTemplate: { prompt: 'old prompt' },
        catchUpPolicy: { kind: 'skip-missed' }
      })
      const intervalHandles = (
        scheduler as unknown as {
          intervalHandles: Map<string, { callback: () => void | Promise<void> }>
        }
      ).intervalHandles
      const scheduleKey = `schedule:${snap.id}`
      const originalEntry = intervalHandles.get(scheduleKey)

      const latestTemplate = { prompt: 'new prompt' }
      jobManager.updateJobSchedule(snap.id, { jobInputTemplate: latestTemplate })

      expect(intervalHandles.get(scheduleKey)).toBe(originalEntry)
      await originalEntry?.callback()
      expect(jobService.list({ scheduleId: snap.id })).toEqual([expect.objectContaining({ input: latestTemplate })])
    })

    it('(f) trigger update onto a spent once: disposes the stale registration and does not re-arm', async () => {
      const snap = jobManager.registerJobSchedule({
        type: DUMMY_TYPE,
        name: 'case-f',
        trigger: { kind: 'once', at: Date.now() + 600_000 },
        jobInputTemplate: {} as Record<string, unknown>,
        catchUpPolicy: { kind: 'skip-missed' }
      })
      expect(getScheduleDisposables().has(snap.id)).toBe(true)

      // Manual fire writes lastRun < at (extra one-shot; natural fire still pending).
      expect(await jobManager.triggerJobScheduleNowById(snap.id)).toBe(true)

      // Reschedule onto a past moment already covered by the manual fire — the
      // updated snapshot is spent, so the pending timer for the old future `at`
      // must be disposed rather than left to fire with its stale closure.
      const updated = jobManager.updateJobSchedule(snap.id, {
        trigger: { kind: 'once', at: Date.now() - 60_000 }
      })

      expect(updated?.enabled).toBe(true)
      expect(getScheduleDisposables().has(snap.id)).toBe(false)
    })

    it('returns null when the id does not exist (no re-arm side effects)', async () => {
      const armSpy = vi.spyOn(jobManager as unknown as { armSchedule: (s: unknown) => void }, 'armSchedule')

      const result = jobManager.updateJobSchedule('does-not-exist', { trigger: altTrigger })

      expect(result).toBeNull()
      expect(armSpy).not.toHaveBeenCalled()
    })
  })

  // ----------------------------------------------------------------------
  // Transactional schedule primitives (registerJobScheduleTx /
  // updateJobScheduleTx / syncJobScheduleTimerById) — pure DB writes inside
  // the caller's tx, timer sync only on the explicit post-commit call.
  // ----------------------------------------------------------------------

  describe('transactional schedule primitives', () => {
    function getScheduleDisposables(): Map<string, Disposable> {
      return (jobManager as unknown as { scheduleDisposables: Map<string, Disposable> }).scheduleDisposables
    }
    function getIntervalEntry(scheduleId: string): unknown {
      const handles = (scheduler as unknown as { intervalHandles: Map<string, unknown> }).intervalHandles
      return handles.get(`schedule:${scheduleId}`)
    }
    function spyArm() {
      return vi.spyOn(jobManager as unknown as { armSchedule: (s: unknown) => void }, 'armSchedule')
    }
    const baseInput = {
      type: DUMMY_TYPE,
      trigger: baseTrigger,
      jobInputTemplate: {} as Record<string, unknown>,
      catchUpPolicy: { kind: 'skip-missed' as const }
    }

    it('registerJobScheduleTx writes the row but never touches the timer', () => {
      const armSpy = spyArm()

      const { id } = dbh.db.transaction((tx) => jobManager.registerJobScheduleTx(tx, { ...baseInput, name: 'tx-a' }))

      expect(jobScheduleService.getById(id)).toMatchObject({ name: 'tx-a', enabled: true })
      expect(armSpy).not.toHaveBeenCalled()
      expect(getScheduleDisposables().has(id)).toBe(false)
      expect(scheduler.has(`schedule:${id}`)).toBe(false)
      armSpy.mockRestore()
    })

    it('updateJobScheduleTx writes the row but leaves the armed timer (and its phase) untouched', () => {
      const snap = jobManager.registerJobSchedule({ ...baseInput, name: 'tx-b' })
      const originalEntry = getIntervalEntry(snap.id)
      expect(originalEntry).toBeDefined()
      const armSpy = spyArm()

      const updated = dbh.db.transaction((tx) => jobManager.updateJobScheduleTx(tx, snap.id, { trigger: altTrigger }))

      expect(updated?.trigger).toEqual(altTrigger)
      expect(jobScheduleService.getById(snap.id)?.trigger).toEqual(altTrigger)
      expect(armSpy).not.toHaveBeenCalled()
      // Negative control: the interval entry is the SAME object — no re-arm, no phase reset.
      expect(getIntervalEntry(snap.id)).toBe(originalEntry)
      armSpy.mockRestore()
    })

    it('a rolled-back registerJobScheduleTx leaves zero rows and zero timer side effects', () => {
      const before = jobScheduleService.listAll({ type: DUMMY_TYPE }).length
      const armSpy = spyArm()

      expect(() =>
        dbh.db.transaction((tx) => {
          jobManager.registerJobScheduleTx(tx, { ...baseInput, name: 'tx-rollback' })
          throw new Error('business write failed')
        })
      ).toThrow('business write failed')

      expect(jobScheduleService.listAll({ type: DUMMY_TYPE })).toHaveLength(before)
      expect(armSpy).not.toHaveBeenCalled()
      armSpy.mockRestore()
    })

    it('a rolled-back updateJobScheduleTx leaves the old row AND the armed timer untouched', () => {
      const snap = jobManager.registerJobSchedule({ ...baseInput, name: 'tx-c' })
      const originalEntry = getIntervalEntry(snap.id)

      expect(() =>
        dbh.db.transaction((tx) => {
          jobManager.updateJobScheduleTx(tx, snap.id, { trigger: altTrigger })
          throw new Error('related write failed')
        })
      ).toThrow('related write failed')

      // Row rolled back to the original trigger; timer identity (phase) untouched.
      expect(jobScheduleService.getById(snap.id)?.trigger).toEqual(baseTrigger)
      expect(getIntervalEntry(snap.id)).toBe(originalEntry)
    })

    it('syncJobScheduleTimerById arms an enabled row exactly once', () => {
      const { id } = dbh.db.transaction((tx) => jobManager.registerJobScheduleTx(tx, { ...baseInput, name: 'tx-d' }))
      const armSpy = spyArm()

      jobManager.syncJobScheduleTimerById(id)

      expect(armSpy).toHaveBeenCalledTimes(1)
      expect(scheduler.has(`schedule:${id}`)).toBe(true)
      expect(getScheduleDisposables().has(id)).toBe(true)
      armSpy.mockRestore()
    })

    it('syncJobScheduleTimerById disposes the timer for a disabled row', () => {
      const snap = jobManager.registerJobSchedule({ ...baseInput, name: 'tx-e' })
      expect(scheduler.has(`schedule:${snap.id}`)).toBe(true)

      dbh.db.transaction((tx) => jobManager.updateJobScheduleTx(tx, snap.id, { enabled: false }))
      // Pure tx write: still armed until the explicit sync.
      expect(scheduler.has(`schedule:${snap.id}`)).toBe(true)

      jobManager.syncJobScheduleTimerById(snap.id)

      expect(scheduler.has(`schedule:${snap.id}`)).toBe(false)
      expect(getScheduleDisposables().has(snap.id)).toBe(false)
    })

    it('syncJobScheduleTimerById logs instead of throwing when the arm fails — the committed row must not read as a failed command', () => {
      const { id } = dbh.db.transaction((tx) =>
        jobManager.registerJobScheduleTx(tx, { ...baseInput, name: 'tx-arm-fail' })
      )
      const armSpy = spyArm().mockImplementation(() => {
        throw new Error('arm exploded')
      })

      expect(() => jobManager.syncJobScheduleTimerById(id)).not.toThrow()

      expect(jobScheduleService.getById(id)).not.toBeNull()
      armSpy.mockRestore()
    })

    it('syncJobScheduleTimerById disposes a stale timer when the row is gone', () => {
      const snap = jobManager.registerJobSchedule({ ...baseInput, name: 'tx-f' })
      jobScheduleService.delete(snap.id)

      jobManager.syncJobScheduleTimerById(snap.id)

      expect(scheduler.has(`schedule:${snap.id}`)).toBe(false)
      expect(getScheduleDisposables().has(snap.id)).toBe(false)
    })

    // Trigger-semantics validation runs BEFORE any write: an invalid cron
    // expression / timezone / out-of-range interval can never commit a row
    // whose post-commit arm would then fail (armSchedule disposes the old
    // timer first — that failure mode would strand "config committed, no timer").
    it('registerJobScheduleTx rejects an invalid cron expression up front with zero writes', () => {
      const before = jobScheduleService.listAll({ type: DUMMY_TYPE }).length

      expect(() =>
        dbh.db.transaction((tx) =>
          jobManager.registerJobScheduleTx(tx, {
            ...baseInput,
            name: 'bad-cron',
            trigger: { kind: 'cron', expr: 'not a cron' }
          })
        )
      ).toThrow(JOB_ERROR_CODES.SCHEDULE_TRIGGER_INVALID)

      expect(jobScheduleService.listAll({ type: DUMMY_TYPE })).toHaveLength(before)
    })

    it('registerJobScheduleTx rejects an unknown IANA timezone up front', () => {
      expect(() =>
        dbh.db.transaction((tx) =>
          jobManager.registerJobScheduleTx(tx, {
            ...baseInput,
            name: 'bad-tz',
            trigger: { kind: 'cron', expr: '0 0 * * *', timezone: 'Not/AZone' }
          })
        )
      ).toThrow(JOB_ERROR_CODES.SCHEDULE_TRIGGER_INVALID)
    })

    it('registerJobScheduleTx rejects an interval beyond the setTimeout delay limit', () => {
      expect(() =>
        dbh.db.transaction((tx) =>
          jobManager.registerJobScheduleTx(tx, {
            ...baseInput,
            name: 'overflow',
            trigger: { kind: 'interval', ms: 2 ** 31 }
          })
        )
      ).toThrow(JOB_ERROR_CODES.SCHEDULE_TRIGGER_INVALID)
    })

    it('registerJobScheduleTx rejects a once trigger beyond the setTimeout delay limit', () => {
      expect(() =>
        dbh.db.transaction((tx) =>
          jobManager.registerJobScheduleTx(tx, {
            ...baseInput,
            name: 'once-overflow',
            trigger: { kind: 'once', at: Date.now() + 2 ** 31 + 60_000 }
          })
        )
      ).toThrow(JOB_ERROR_CODES.SCHEDULE_TRIGGER_INVALID)
      expect(jobScheduleService.listAll({ type: DUMMY_TYPE })).toHaveLength(0)
    })

    it('updateJobScheduleTx rejects an invalid trigger and leaves row, subscriptions and timer untouched', () => {
      const snap = jobManager.registerJobSchedule({ ...baseInput, name: 'tx-g' })
      const originalEntry = getIntervalEntry(snap.id)

      expect(() =>
        dbh.db.transaction((tx) =>
          jobManager.updateJobScheduleTx(tx, snap.id, { trigger: { kind: 'cron', expr: '61 61 * * *' } })
        )
      ).toThrow(JOB_ERROR_CODES.SCHEDULE_TRIGGER_INVALID)

      expect(jobScheduleService.getById(snap.id)?.trigger).toEqual(baseTrigger)
      expect(getIntervalEntry(snap.id)).toBe(originalEntry)
    })

    it('registerJobScheduleTx enforces the schedule-name atom before writing', () => {
      expect(() =>
        dbh.db.transaction((tx) => jobManager.registerJobScheduleTx(tx, { ...baseInput, name: '__reserved' }))
      ).toThrow(JOB_ERROR_CODES.SCHEDULE_NAME_INVALID)
    })
  })
})
