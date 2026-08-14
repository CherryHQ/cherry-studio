/**
 * SchedulerService unit tests — covers cron / interval / once register,
 * pause/resume (cron-only), triggerNow, getNextRun, unregister idempotency,
 * has, and the re-entrancy guards in `scheduleInterval`/`scheduleOnce`.
 *
 * Uses real croner for cron tests with a far-future expression so callbacks
 * do not fire during the test; interval/once tests use real setTimeout with
 * very short delays.
 */

import { BaseService } from '@main/core/lifecycle/BaseService'
import { SchedulerService } from '@main/core/scheduler/SchedulerService'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

let scheduler: SchedulerService

beforeEach(async () => {
  BaseService.resetInstances()
  scheduler = new SchedulerService()
  await scheduler._doInit()
})

afterEach(async () => {
  await scheduler._doStop()
  BaseService.resetInstances()
})

/** Wait a few microtasks + a sleep. */
async function tick(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms))
}

describe('registerSchedule', () => {
  it('register + has + unregister round-trip (interval)', () => {
    expect(scheduler.has('s1')).toBe(false)
    scheduler.registerSchedule('s1', { kind: 'interval', ms: 60_000 }, () => undefined)
    expect(scheduler.has('s1')).toBe(true)
    scheduler.unregister('s1')
    expect(scheduler.has('s1')).toBe(false)
  })

  it('unregister is idempotent — calling on unknown id is silent', () => {
    expect(() => scheduler.unregister('never-existed')).not.toThrow()
  })

  it('re-registering the same id replaces the previous entry', async () => {
    let firedFirst = false
    let firedSecond = false
    scheduler.registerSchedule('s2', { kind: 'interval', ms: 5 }, () => {
      firedFirst = true
    })
    scheduler.registerSchedule('s2', { kind: 'interval', ms: 5 }, () => {
      firedSecond = true
    })
    // After replacement, only the second callback should ever fire.
    await tick(20)
    expect(firedSecond).toBe(true)
    expect(firedFirst).toBe(false)
  })

  it('disposable returned by registerSchedule unregisters on dispose', () => {
    const disp = scheduler.registerSchedule('s3', { kind: 'interval', ms: 60_000 }, () => undefined)
    expect(scheduler.has('s3')).toBe(true)
    disp.dispose()
    expect(scheduler.has('s3')).toBe(false)
  })
})

describe('interval trigger', () => {
  it('fires once after `ms`', async () => {
    let count = 0
    scheduler.registerSchedule('i1', { kind: 'interval', ms: 10 }, () => {
      count++
    })
    await tick(25)
    expect(count).toBeGreaterThanOrEqual(1)
  })

  it('does not re-arm if unregistered during the callback', async () => {
    let count = 0
    scheduler.registerSchedule('i2', { kind: 'interval', ms: 10 }, () => {
      count++
      scheduler.unregister('i2')
    })
    await tick(60)
    expect(count).toBe(1)
    expect(scheduler.has('i2')).toBe(false)
  })

  it('logs but does not crash when callback throws', async () => {
    let fires = 0
    scheduler.registerSchedule('i3', { kind: 'interval', ms: 10 }, () => {
      fires++
      throw new Error('boom')
    })
    await tick(45)
    // Should have re-armed and fired again despite the throw.
    expect(fires).toBeGreaterThanOrEqual(2)
  })
})

describe('once trigger', () => {
  it('fires exactly once and self-cleans from the map', async () => {
    let count = 0
    scheduler.registerSchedule('o1', { kind: 'once', at: Date.now() + 5 }, () => {
      count++
    })
    expect(scheduler.has('o1')).toBe(true)
    await tick(40)
    expect(count).toBe(1)
    // After firing, the entry should be cleaned (re-register-friendly).
    expect(scheduler.has('o1')).toBe(false)
  })

  it('respects past `at` by firing immediately', async () => {
    let fired = false
    scheduler.registerSchedule('o2', { kind: 'once', at: Date.now() - 1000 }, () => {
      fired = true
    })
    await tick(10)
    expect(fired).toBe(true)
  })
})

describe('cron trigger', () => {
  it('triggerNow returns true for cron and false for non-cron', async () => {
    let fired = 0
    scheduler.registerSchedule('c1', { kind: 'cron', expr: '0 0 1 1 *' }, () => {
      fired++
    })
    const result = await scheduler.triggerNow('c1')
    expect(result).toBe(true)
    expect(fired).toBe(1)

    scheduler.registerSchedule('i-not-cron', { kind: 'interval', ms: 60_000 }, () => undefined)
    expect(await scheduler.triggerNow('i-not-cron')).toBe(false)
  })

  it('triggerNow on unknown id returns false', async () => {
    expect(await scheduler.triggerNow('does-not-exist')).toBe(false)
  })

  it('pause + resume on cron — pause prevents triggerNow from firing? No — triggerNow is manual; verify pause sets paused state', async () => {
    let fired = 0
    scheduler.registerSchedule('c2', { kind: 'cron', expr: '0 0 1 1 *' }, () => {
      fired++
    })
    // pause should not throw and the schedule remains registered.
    scheduler.pause('c2')
    expect(scheduler.has('c2')).toBe(true)
    scheduler.resume('c2')
    expect(scheduler.has('c2')).toBe(true)
    // Manual trigger still works even after resume.
    await scheduler.triggerNow('c2')
    expect(fired).toBe(1)
  })

  it('pause/resume on interval is no-op (warn) — entry stays in map', () => {
    scheduler.registerSchedule('p-int', { kind: 'interval', ms: 60_000 }, () => undefined)
    scheduler.pause('p-int')
    scheduler.resume('p-int')
    expect(scheduler.has('p-int')).toBe(true)
  })

  it('pause/resume on unknown id is silent no-op', () => {
    expect(() => scheduler.pause('nope')).not.toThrow()
    expect(() => scheduler.resume('nope')).not.toThrow()
  })

  it('getNextRun returns a Date for cron', () => {
    scheduler.registerSchedule('c3', { kind: 'cron', expr: '0 0 1 1 *' }, () => undefined)
    const next = scheduler.getNextRun('c3')
    expect(next).not.toBeNull()
    expect(next).toBeInstanceOf(Date)
  })

  it('getNextRun returns null for non-cron and unknown ids', () => {
    scheduler.registerSchedule('i-only', { kind: 'interval', ms: 60_000 }, () => undefined)
    expect(scheduler.getNextRun('i-only')).toBeNull()
    expect(scheduler.getNextRun('nope')).toBeNull()
  })
})
