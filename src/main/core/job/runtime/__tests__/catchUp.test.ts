/**
 * Pure-function unit tests for `computeCatchUpAction`. Verifies the overdue
 * detection per trigger kind and the two catch-up policies (`skip-missed`,
 * `after-startup`) without standing up a JobManager / SchedulerService.
 */

import { computeCatchUpAction } from '@main/core/job/runtime/catchUp'
import type { JobHandler } from '@main/core/job/types'
import type { JobScheduleSnapshot } from '@shared/data/api/schemas/jobs'
import { describe, expect, it } from 'vitest'

const NOW = 1_700_000_000_000 // 2023-11-14T22:13:20Z

function makeSchedule(
  overrides: Partial<JobScheduleSnapshot> & Pick<JobScheduleSnapshot, 'trigger' | 'catchUpPolicy'>
): JobScheduleSnapshot {
  const base: JobScheduleSnapshot = {
    id: 'sched-1',
    type: 't.x',
    name: null,
    trigger: overrides.trigger,
    jobInputTemplate: null,
    enabled: true,
    nextRun: null,
    lastRun: null,
    catchUpPolicy: overrides.catchUpPolicy,
    metadata: {},
    createdAt: new Date(NOW - 60_000).toISOString(),
    updatedAt: new Date(NOW - 60_000).toISOString()
  }
  return { ...base, ...overrides }
}

function handlerWithMissed(): JobHandler {
  return {
    recovery: 'abandon',
    async execute() {
      return null
    },
    onMissed() {
      /* noop — presence enables missEvent */
    }
  }
}

function handlerWithoutMissed(): JobHandler {
  return {
    recovery: 'abandon',
    async execute() {
      return null
    }
  }
}

describe('computeCatchUpAction — cron trigger', () => {
  it('returns not-overdue when nextRun is null', () => {
    const schedule = makeSchedule({
      trigger: { kind: 'cron', expr: '*/5 * * * *' },
      catchUpPolicy: { kind: 'after-startup', minutes: 5 }
    })
    const result = computeCatchUpAction(schedule, handlerWithMissed(), NOW)
    expect(result.shouldEnqueue).toBe(false)
    expect(result.missEvent).toBeNull()
  })

  it('returns not-overdue when nextRun is in the future', () => {
    const schedule = makeSchedule({
      trigger: { kind: 'cron', expr: '*/5 * * * *' },
      catchUpPolicy: { kind: 'after-startup', minutes: 5 },
      nextRun: new Date(NOW + 60_000).toISOString()
    })
    const result = computeCatchUpAction(schedule, handlerWithMissed(), NOW)
    expect(result.shouldEnqueue).toBe(false)
    expect(result.missEvent).toBeNull()
  })

  it('overdue + skip-missed emits missEvent but does NOT enqueue', () => {
    const schedule = makeSchedule({
      trigger: { kind: 'cron', expr: '*/5 * * * *' },
      catchUpPolicy: { kind: 'skip-missed' },
      nextRun: new Date(NOW - 60_000).toISOString(),
      lastRun: new Date(NOW - 360_000).toISOString()
    })
    const result = computeCatchUpAction(schedule, handlerWithMissed(), NOW)
    expect(result.shouldEnqueue).toBe(false)
    expect(result.missEvent).not.toBeNull()
    expect(result.missEvent?.lastFireAt).toBe(NOW - 360_000)
  })

  it('overdue + after-startup enqueues with the configured delay', () => {
    const schedule = makeSchedule({
      trigger: { kind: 'cron', expr: '*/5 * * * *' },
      catchUpPolicy: { kind: 'after-startup', minutes: 3 },
      nextRun: new Date(NOW - 1000).toISOString()
    })
    const result = computeCatchUpAction(schedule, handlerWithMissed(), NOW)
    expect(result.shouldEnqueue).toBe(true)
    expect(result.enqueueDelayMs).toBe(3 * 60_000)
    expect(result.missEvent).not.toBeNull()
  })

  it('handler without onMissed yields no missEvent even when overdue', () => {
    const schedule = makeSchedule({
      trigger: { kind: 'cron', expr: '*/5 * * * *' },
      catchUpPolicy: { kind: 'after-startup', minutes: 1 },
      nextRun: new Date(NOW - 1000).toISOString()
    })
    const result = computeCatchUpAction(schedule, handlerWithoutMissed(), NOW)
    expect(result.shouldEnqueue).toBe(true)
    expect(result.missEvent).toBeNull()
  })
})

describe('computeCatchUpAction — interval trigger', () => {
  it('is overdue once a grid point has passed since the last fire', () => {
    const schedule = makeSchedule({
      trigger: { kind: 'interval', ms: 60_000 },
      catchUpPolicy: { kind: 'after-startup', minutes: 0 },
      lastRun: new Date(NOW - 90_000).toISOString()
    })
    // Last fired 90s ago, interval is 60s → next due was 30s ago → overdue.
    const result = computeCatchUpAction(schedule, handlerWithMissed(), NOW)
    expect(result.shouldEnqueue).toBe(true)
    expect(result.missEvent).not.toBeNull()
  })

  it('uses createdAt + ms as anchor when lastRun is null', () => {
    const schedule = makeSchedule({
      trigger: { kind: 'interval', ms: 30_000 },
      catchUpPolicy: { kind: 'skip-missed' },
      createdAt: new Date(NOW - 120_000).toISOString()
    })
    // Created 120s ago, interval 30s → overdue (multiple intervals passed).
    const result = computeCatchUpAction(schedule, handlerWithMissed(), NOW)
    // skip-missed: no enqueue, but missEvent emitted.
    expect(result.shouldEnqueue).toBe(false)
    expect(result.missEvent).not.toBeNull()
  })

  it('is not overdue when last fire + interval is still in the future', () => {
    const schedule = makeSchedule({
      trigger: { kind: 'interval', ms: 120_000 },
      catchUpPolicy: { kind: 'after-startup', minutes: 0 },
      lastRun: new Date(NOW - 30_000).toISOString()
    })
    // Last fired 30s ago, interval 120s → next due in 90s → not overdue.
    const result = computeCatchUpAction(schedule, handlerWithMissed(), NOW)
    expect(result.shouldEnqueue).toBe(false)
    expect(result.missEvent).toBeNull()
  })

  // A manual fire writes lastRun but must not move the calendar — otherwise an
  // off-grid fire hides the next missed grid point for a whole extra period.
  describe('an off-grid fire does not shift the calendar', () => {
    const HOUR = 3_600_000
    // Created 00:00, every 6h → grid at 06:00 / 12:00 / 18:00.
    // Manually fired 08:00. NOW is 13:00, so the 12:00 point was missed.
    const manuallyFiredOffGrid = makeSchedule({
      trigger: { kind: 'interval', ms: 6 * HOUR },
      catchUpPolicy: { kind: 'after-startup', minutes: 0 },
      createdAt: new Date(NOW - 13 * HOUR).toISOString(),
      lastRun: new Date(NOW - 5 * HOUR).toISOString()
    })

    it('reports the missed grid point rather than waiting a period from the manual fire', () => {
      const result = computeCatchUpAction(manuallyFiredOffGrid, handlerWithMissed(), NOW)
      // Anchoring on lastRun + ms would put the next due at 14:00 and miss this.
      expect(result.shouldEnqueue).toBe(true)
      expect(result.missEvent).not.toBeNull()
    })

    it('stays not-overdue before that grid point arrives', () => {
      // 11:00 — the 12:00 point has not come yet.
      const result = computeCatchUpAction(manuallyFiredOffGrid, handlerWithMissed(), NOW - 2 * HOUR)
      expect(result.shouldEnqueue).toBe(false)
      expect(result.missEvent).toBeNull()
    })
  })
})

describe('computeCatchUpAction — once trigger', () => {
  it('once trigger is never considered overdue here', () => {
    // SchedulerService.scheduleOnce owns the timer for `once`; catch-up
    // should not duplicate it on startup.
    const schedule = makeSchedule({
      trigger: { kind: 'once', at: NOW - 60_000 },
      catchUpPolicy: { kind: 'after-startup', minutes: 0 }
    })
    const result = computeCatchUpAction(schedule, handlerWithMissed(), NOW)
    expect(result.shouldEnqueue).toBe(false)
    expect(result.missEvent).toBeNull()
  })
})
