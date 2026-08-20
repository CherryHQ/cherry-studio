/**
 * Pure-function unit tests for `intervalFirstDelay`. Pins the wall-clock grid:
 * an interval fires at `createdAt + k × ms` regardless of when it is armed, so
 * restarts and resumes cannot slide the cadence forward.
 */

import { intervalFirstDelay } from '@main/core/job/runtime/intervalPhase'
import type { JobScheduleSnapshot } from '@shared/data/api/schemas/jobs'
import { describe, expect, it } from 'vitest'

const CREATED_AT = 1_700_000_000_000 // 2023-11-14T22:13:20Z
const HOUR = 3_600_000

function makeSchedule(trigger: JobScheduleSnapshot['trigger']): JobScheduleSnapshot {
  return {
    id: 'sched-1',
    type: 't.x',
    name: null,
    trigger,
    jobInputTemplate: null,
    enabled: true,
    nextRun: null,
    lastRun: null,
    catchUpPolicy: { kind: 'skip-missed' },
    metadata: {},
    createdAt: new Date(CREATED_AT).toISOString(),
    updatedAt: new Date(CREATED_AT).toISOString()
  }
}

describe('intervalFirstDelay', () => {
  const every6h = makeSchedule({ kind: 'interval', ms: 6 * HOUR })

  it('waits a full period when armed at the moment of creation', () => {
    expect(intervalFirstDelay(every6h, CREATED_AT)).toBe(6 * HOUR)
  })

  it('targets the next grid point when armed mid-period', () => {
    // 7h after creation: the 6h point is gone, the 12h point is 5h away.
    expect(intervalFirstDelay(every6h, CREATED_AT + 7 * HOUR)).toBe(5 * HOUR)
  })

  it('keeps the same grid however many periods elapsed while unarmed', () => {
    // A week of downtime must not shift the cadence off createdAt + 6k hours.
    expect(intervalFirstDelay(every6h, CREATED_AT + 170 * HOUR)).toBe(4 * HOUR)
  })

  it('waits a full period when armed exactly on a grid point, never firing instantly', () => {
    expect(intervalFirstDelay(every6h, CREATED_AT + 12 * HOUR)).toBe(6 * HOUR)
  })

  it('stays within one period when the clock moved back behind createdAt', () => {
    const delay = intervalFirstDelay(every6h, CREATED_AT - 2 * HOUR)
    expect(delay).toBeGreaterThan(0)
    expect(delay).toBeLessThanOrEqual(6 * HOUR)
  })

  it('leaves cron and once triggers to their own timing', () => {
    expect(intervalFirstDelay(makeSchedule({ kind: 'cron', expr: '0 * * * *' }), CREATED_AT)).toBeUndefined()
    expect(intervalFirstDelay(makeSchedule({ kind: 'once', at: CREATED_AT + HOUR }), CREATED_AT)).toBeUndefined()
  })
})
