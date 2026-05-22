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

import { application } from '@application'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { JOB_ERROR_CODES } from '@main/core/job/errorCodes'
import { JobManager } from '@main/core/job/JobManager'
import type { Trigger } from '@main/core/job/scheduleTypes'
import type { JobHandler } from '@main/core/job/types'
import { BaseService } from '@main/core/lifecycle/BaseService'
import type { Disposable } from '@main/core/lifecycle/event'
import { SchedulerService } from '@main/core/scheduler/SchedulerService'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainCacheServiceExport } from '@test-mocks/main/CacheService'
import { MockMainDbServiceExport } from '@test-mocks/main/DbService'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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

describe('JobManager schedule control APIs', () => {
  setupTestDatabase()
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
    const map = (jobManager as unknown as { scheduleDisposables: Map<string, Disposable> }).scheduleDisposables
    for (const disp of map.values()) disp.dispose()
    map.clear()
  })

  // ----------------------------------------------------------------------
  // by-id family — found returns true, missing returns false (no throw)
  // ----------------------------------------------------------------------

  describe('by-id', () => {
    it('pauseJobScheduleById returns true for existing, false for missing', async () => {
      const snap = await jobManager.registerJobSchedule({
        type: DUMMY_TYPE,
        trigger: baseTrigger,
        jobInputTemplate: {} as Record<string, unknown>,
        catchUpPolicy: { kind: 'skip-missed' }
      })

      expect(await jobManager.pauseJobScheduleById(snap.id)).toBe(true)
      expect(await jobManager.pauseJobScheduleById('does-not-exist')).toBe(false)
    })

    it('resumeJobScheduleById returns true for existing, false for missing', async () => {
      const snap = await jobManager.registerJobSchedule({
        type: DUMMY_TYPE,
        trigger: baseTrigger,
        jobInputTemplate: {} as Record<string, unknown>,
        catchUpPolicy: { kind: 'skip-missed' }
      })

      expect(await jobManager.resumeJobScheduleById(snap.id)).toBe(true)
      expect(await jobManager.resumeJobScheduleById('does-not-exist')).toBe(false)
    })

    it('unregisterJobScheduleById returns true for existing, false for missing', async () => {
      const snap = await jobManager.registerJobSchedule({
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
      await jobManager.registerJobSchedule({
        type: DUMMY_TYPE,
        name: 'nightly',
        trigger: baseTrigger,
        jobInputTemplate: {} as Record<string, unknown>,
        catchUpPolicy: { kind: 'skip-missed' }
      })

      expect(await jobManager.pauseJobSchedule(DUMMY_TYPE, 'nightly')).toBe(true)
    })

    it('resumeJobSchedule(type, name) resolves and resumes', async () => {
      await jobManager.registerJobSchedule({
        type: DUMMY_TYPE,
        name: 'morning',
        trigger: baseTrigger,
        jobInputTemplate: {} as Record<string, unknown>,
        catchUpPolicy: { kind: 'skip-missed' }
      })

      expect(await jobManager.resumeJobSchedule(DUMMY_TYPE, 'morning')).toBe(true)
    })

    it('triggerJobScheduleNow(type, name) returns true for an armed cron-free schedule', async () => {
      await jobManager.registerJobSchedule({
        type: DUMMY_TYPE,
        name: 'evening',
        trigger: baseTrigger,
        jobInputTemplate: {} as Record<string, unknown>,
        catchUpPolicy: { kind: 'skip-missed' }
      })

      expect(await jobManager.triggerJobScheduleNow(DUMMY_TYPE, 'evening')).toBe(true)
    })

    it('unregisterJobSchedule(type, name) deletes the row', async () => {
      const snap = await jobManager.registerJobSchedule({
        type: DUMMY_TYPE,
        name: 'to-delete',
        trigger: baseTrigger,
        jobInputTemplate: {} as Record<string, unknown>,
        catchUpPolicy: { kind: 'skip-missed' }
      })

      expect(await jobManager.unregisterJobSchedule(DUMMY_TYPE, 'to-delete')).toBe(true)
      expect(await jobScheduleService.getById(snap.id)).toBeNull()
    })

    it('resolves the singleton when name is omitted on a single-schedule type', async () => {
      await jobManager.registerJobSchedule({
        type: DUMMY_TYPE,
        trigger: baseTrigger,
        jobInputTemplate: {} as Record<string, unknown>,
        catchUpPolicy: { kind: 'skip-missed' }
      })

      expect(await jobManager.pauseJobSchedule(DUMMY_TYPE)).toBe(true)
    })

    it('throws SCHEDULE_NAME_REQUIRED when type has multiple schedules and name is omitted', async () => {
      await jobManager.registerJobSchedule({
        type: DUMMY_TYPE,
        name: 'a',
        trigger: baseTrigger,
        jobInputTemplate: {} as Record<string, unknown>,
        catchUpPolicy: { kind: 'skip-missed' }
      })
      await jobManager.registerJobSchedule({
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
      const snap = await jobManager.registerJobSchedule({
        type: DUMMY_TYPE,
        name: 'case-a',
        trigger: baseTrigger,
        jobInputTemplate: {} as Record<string, unknown>,
        catchUpPolicy: { kind: 'skip-missed' }
      })
      const armSpy = vi.spyOn(jobManager as unknown as { armSchedule: (s: unknown) => void }, 'armSchedule')

      const updated = await jobManager.updateJobSchedule(snap.id, { trigger: altTrigger })

      expect(updated?.enabled).toBe(true)
      expect(armSpy).toHaveBeenCalledTimes(1)
    })

    it('(b) trigger + enabled false: disposes and does not re-arm', async () => {
      const snap = await jobManager.registerJobSchedule({
        type: DUMMY_TYPE,
        name: 'case-b',
        trigger: baseTrigger,
        jobInputTemplate: {} as Record<string, unknown>,
        catchUpPolicy: { kind: 'skip-missed' }
      })
      const armSpy = vi.spyOn(jobManager as unknown as { armSchedule: (s: unknown) => void }, 'armSchedule')

      const updated = await jobManager.updateJobSchedule(snap.id, { trigger: altTrigger, enabled: false })

      expect(updated?.enabled).toBe(false)
      expect(armSpy).not.toHaveBeenCalled()
      expect(getScheduleDisposables().has(snap.id)).toBe(false)
    })

    it('(c) enabled-only false→true: re-arms', async () => {
      const snap = await jobManager.registerJobSchedule({
        type: DUMMY_TYPE,
        name: 'case-c',
        trigger: baseTrigger,
        jobInputTemplate: {} as Record<string, unknown>,
        catchUpPolicy: { kind: 'skip-missed' }
      })
      // Disable first; this disposes the in-process entry but keeps the row.
      await jobManager.updateJobSchedule(snap.id, { enabled: false })
      expect(getScheduleDisposables().has(snap.id)).toBe(false)

      const armSpy = vi.spyOn(jobManager as unknown as { armSchedule: (s: unknown) => void }, 'armSchedule')
      const updated = await jobManager.updateJobSchedule(snap.id, { enabled: true })

      expect(updated?.enabled).toBe(true)
      expect(armSpy).toHaveBeenCalledTimes(1)
    })

    it('(d) enabled-only true→false: disposes', async () => {
      const snap = await jobManager.registerJobSchedule({
        type: DUMMY_TYPE,
        name: 'case-d',
        trigger: baseTrigger,
        jobInputTemplate: {} as Record<string, unknown>,
        catchUpPolicy: { kind: 'skip-missed' }
      })
      expect(getScheduleDisposables().has(snap.id)).toBe(true)

      const updated = await jobManager.updateJobSchedule(snap.id, { enabled: false })

      expect(updated?.enabled).toBe(false)
      expect(getScheduleDisposables().has(snap.id)).toBe(false)
    })

    it('(e) neither trigger nor enabled in patch: no re-arm', async () => {
      const snap = await jobManager.registerJobSchedule({
        type: DUMMY_TYPE,
        name: 'case-e',
        trigger: baseTrigger,
        jobInputTemplate: { initial: true },
        catchUpPolicy: { kind: 'skip-missed' }
      })
      const originalDisp = getScheduleDisposables().get(snap.id)
      const armSpy = vi.spyOn(jobManager as unknown as { armSchedule: (s: unknown) => void }, 'armSchedule')

      const updated = await jobManager.updateJobSchedule(snap.id, { jobInputTemplate: { updated: true } })

      expect(updated?.jobInputTemplate).toEqual({ updated: true })
      expect(armSpy).not.toHaveBeenCalled()
      expect(getScheduleDisposables().get(snap.id)).toBe(originalDisp)
    })

    it('returns null when the id does not exist (no re-arm side effects)', async () => {
      const armSpy = vi.spyOn(jobManager as unknown as { armSchedule: (s: unknown) => void }, 'armSchedule')

      const result = await jobManager.updateJobSchedule('does-not-exist', { trigger: altTrigger })

      expect(result).toBeNull()
      expect(armSpy).not.toHaveBeenCalled()
    })
  })
})
