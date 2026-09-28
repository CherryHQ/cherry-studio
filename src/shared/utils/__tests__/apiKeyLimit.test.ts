import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AI_USAGE_RECORD_MAX_RANGE_DAYS } from '@shared/data/api/schemas/aiUsageRecords'

import {
  dueQuotaNotices,
  forecastQuotaExhaustion,
  periodRenewsAt,
  periodStartOf,
  type QuotaNoticeInput,
  usageStatsFrom
} from '../apiKeyLimit'

describe('periodStartOf', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('total clamps to the stats endpoint max range instead of epoch 0', () => {
    const now = new Date('2026-09-18T14:30:00Z')
    vi.setSystemTime(now)
    const expected = now.getTime() - AI_USAGE_RECORD_MAX_RANGE_DAYS * 24 * 60 * 60 * 1000
    expect(periodStartOf('total')).toBe(expected)
  })

  it('daily returns midnight UTC today', () => {
    vi.setSystemTime(new Date('2026-09-18T14:30:00Z'))
    expect(periodStartOf('daily')).toBe(new Date('2026-09-18T00:00:00Z').getTime())
  })

  it('monthly without anchor returns 1st of current month', () => {
    vi.setSystemTime(new Date('2026-09-18T14:30:00Z'))
    expect(periodStartOf('monthly')).toBe(new Date('2026-09-01T00:00:00Z').getTime())
  })

  it('monthly with anchor on the 17th returns the 17th when today >= 17', () => {
    vi.setSystemTime(new Date('2026-09-18T14:30:00Z'))
    expect(periodStartOf('monthly', '2024-03-17')).toBe(new Date('2026-09-17T00:00:00Z').getTime())
  })

  it('monthly with anchor on the 20th rolls back to previous month when today < 20', () => {
    vi.setSystemTime(new Date('2026-09-18T14:30:00Z'))
    expect(periodStartOf('monthly', '2024-03-20')).toBe(new Date('2026-08-20T00:00:00Z').getTime())
  })

  it('weekly without anchor defaults to Monday', () => {
    // 2026-09-18 is a Friday (day 5), so Monday was Sep 14
    vi.setSystemTime(new Date('2026-09-18T14:30:00Z'))
    expect(periodStartOf('weekly')).toBe(new Date('2026-09-14T00:00:00Z').getTime())
  })

  it('weekly with Wednesday anchor returns most recent Wednesday', () => {
    // 2026-09-18 is Friday; anchor on Wed (day 3) → Sep 16
    vi.setSystemTime(new Date('2026-09-18T14:30:00Z'))
    expect(periodStartOf('weekly', '2026-01-07')).toBe(new Date('2026-09-16T00:00:00Z').getTime())
    // 2026-01-07 is a Wednesday
  })
})

describe('periodRenewsAt', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('total returns null', () => {
    vi.setSystemTime(new Date('2026-09-18T14:30:00Z'))
    expect(periodRenewsAt('total')).toBeNull()
  })

  it('daily returns tomorrow midnight', () => {
    vi.setSystemTime(new Date('2026-09-18T14:30:00Z'))
    expect(periodRenewsAt('daily')).toBe(new Date('2026-09-19T00:00:00Z').getTime())
  })

  it('weekly returns 7 days after period start', () => {
    vi.setSystemTime(new Date('2026-09-18T14:30:00Z'))
    // Monday start → next Monday
    expect(periodRenewsAt('weekly')).toBe(new Date('2026-09-21T00:00:00Z').getTime())
  })

  it('monthly returns next month same anchor day', () => {
    vi.setSystemTime(new Date('2026-09-18T14:30:00Z'))
    // anchor 17 → start Sep 17 → renews Oct 17
    expect(periodRenewsAt('monthly', '2024-03-17')).toBe(new Date('2026-10-17T00:00:00Z').getTime())
  })
})

describe('forecastQuotaExhaustion', () => {
  const HOUR = 3_600_000
  const periodStartMs = new Date('2026-09-18T00:00:00Z').getTime()
  const renewsAtMs = new Date('2026-09-19T00:00:00Z').getTime()

  it('reports exhausted once the limit is reached', () => {
    const forecast = forecastQuotaExhaustion({
      used: 20,
      limit: 20,
      periodStartMs,
      renewsAtMs,
      nowMs: periodStartMs + 6 * HOUR
    })
    expect(forecast).toEqual({ kind: 'exhausted' })
  })

  it('cannot forecast before the first request', () => {
    const forecast = forecastQuotaExhaustion({
      used: 0,
      limit: 20,
      periodStartMs,
      renewsAtMs,
      nowMs: periodStartMs + 6 * HOUR
    })
    expect(forecast).toEqual({ kind: 'unknown' })
  })

  it('projects the run-out moment from the rate so far', () => {
    // 6 requests over 6 hours = 1/hour; 14 left → 14 hours from now, before the 18h-away renewal.
    const nowMs = periodStartMs + 6 * HOUR
    expect(forecastQuotaExhaustion({ used: 6, limit: 20, periodStartMs, renewsAtMs, nowMs })).toEqual({
      kind: 'runs-out',
      atMs: nowMs + 14 * HOUR
    })
  })

  it('reports the quota outlasting the period when renewal comes first', () => {
    // 1 request in 6 hours; 19 left would take 114 hours, far past tomorrow's renewal.
    const forecast = forecastQuotaExhaustion({
      used: 1,
      limit: 20,
      periodStartMs,
      renewsAtMs,
      nowMs: periodStartMs + 6 * HOUR
    })
    expect(forecast).toEqual({ kind: 'within-period' })
  })

  it('still projects a run-out for a total quota, which never renews', () => {
    const nowMs = periodStartMs + 6 * HOUR
    const forecast = forecastQuotaExhaustion({
      used: 1,
      limit: 20,
      periodStartMs,
      renewsAtMs: null,
      nowMs
    })
    expect(forecast).toEqual({ kind: 'runs-out', atMs: nowMs + 19 * 6 * HOUR })
  })
})

describe('dueQuotaNotices', () => {
  const dailyKey = (overrides: Partial<QuotaNoticeInput> = {}): QuotaNoticeInput => ({
    limitKey: 'openrouter::key1',
    period: 'daily',
    limit: 20,
    tier: 'free',
    used: 0,
    ...overrides
  })

  const trialTotalKey = (overrides: Partial<QuotaNoticeInput> = {}): QuotaNoticeInput => ({
    limitKey: 'provider::trialkey',
    period: 'total',
    limit: 10,
    tier: 'trial',
    used: 0,
    ...overrides
  })

  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('records a baseline for a never-before-seen limit without firing a notice', () => {
    vi.setSystemTime(new Date('2026-09-18T14:30:00Z'))
    const { notices, nextState } = dueQuotaNotices([dailyKey()], {})
    expect(notices).toEqual([])
    expect(nextState['openrouter::key1']?.lastPeriodStart).toBe(new Date('2026-09-18T00:00:00Z').getTime())
  })

  it('stays quiet on a later check within the same period', () => {
    vi.setSystemTime(new Date('2026-09-18T08:00:00Z'))
    const first = dueQuotaNotices([dailyKey()], {})

    vi.setSystemTime(new Date('2026-09-18T20:00:00Z'))
    const second = dueQuotaNotices([dailyKey()], first.nextState)

    expect(second.notices).toEqual([])
    expect(second.nextState).toEqual(first.nextState)
  })

  it('fires new_period once the period rolls over, and updates the recorded start', () => {
    vi.setSystemTime(new Date('2026-09-18T08:00:00Z'))
    const first = dueQuotaNotices([dailyKey()], {})

    vi.setSystemTime(new Date('2026-09-19T08:00:00Z'))
    const second = dueQuotaNotices([dailyKey()], first.nextState)

    expect(second.notices).toEqual([{ kind: 'new_period', limitKey: 'openrouter::key1' }])
    expect(second.nextState['openrouter::key1']?.lastPeriodStart).toBe(new Date('2026-09-19T00:00:00Z').getTime())
  })

  it('does not fire new_period twice for the same rollover across repeated checks', () => {
    vi.setSystemTime(new Date('2026-09-18T08:00:00Z'))
    const first = dueQuotaNotices([dailyKey()], {})

    vi.setSystemTime(new Date('2026-09-19T08:00:00Z'))
    const second = dueQuotaNotices([dailyKey()], first.nextState)
    const third = dueQuotaNotices([dailyKey()], second.nextState)

    expect(third.notices).toEqual([])
  })

  it('never fires new_period for a total-period limit, which has no calendar rollover', () => {
    vi.setSystemTime(new Date('2026-09-18T08:00:00Z'))
    const first = dueQuotaNotices([trialTotalKey()], {})

    vi.setSystemTime(new Date('2027-09-18T08:00:00Z'))
    const second = dueQuotaNotices([trialTotalKey()], first.nextState)

    expect(second.notices).toEqual([])
  })

  it('fires trial_exhausted once usage reaches the declared limit', () => {
    vi.setSystemTime(new Date('2026-09-18T08:00:00Z'))
    const { notices, nextState } = dueQuotaNotices([trialTotalKey({ used: 10 })], {})

    expect(notices).toEqual([{ kind: 'trial_exhausted', limitKey: 'provider::trialkey' }])
    expect(nextState['provider::trialkey']?.trialEndingNotifiedAt).toBe(Date.now())
  })

  it('never fires trial_exhausted again for the same key once recorded', () => {
    vi.setSystemTime(new Date('2026-09-18T08:00:00Z'))
    const first = dueQuotaNotices([trialTotalKey({ used: 10 })], {})
    const second = dueQuotaNotices([trialTotalKey({ used: 10 })], first.nextState)

    expect(second.notices).toEqual([])
  })

  it('does not fire trial_exhausted while usage is under the limit', () => {
    vi.setSystemTime(new Date('2026-09-18T08:00:00Z'))
    const { notices } = dueQuotaNotices([trialTotalKey({ used: 9 })], {})
    expect(notices).toEqual([])
  })

  it('never fires trial_exhausted for a free or paid total-period key', () => {
    vi.setSystemTime(new Date('2026-09-18T08:00:00Z'))
    const { notices } = dueQuotaNotices([trialTotalKey({ used: 10, tier: 'free' })], {})
    expect(notices).toEqual([])
  })

  it('never fires trial_exhausted for a trial key on a renewing period — new_period covers it', () => {
    vi.setSystemTime(new Date('2026-09-18T08:00:00Z'))
    const first = dueQuotaNotices([dailyKey({ tier: 'trial', used: 20, limit: 20 })], {})
    expect(first.notices).toEqual([])
  })
})

describe('usageStatsFrom', () => {
  const DAY = 24 * 60 * 60 * 1000
  const now = Date.UTC(2026, 8, 20, 12, 0, 0)

  it('never asks for a range the stats endpoint rejects', () => {
    // `periodStartOf('total')` is epoch 0: a lifetime ceiling has no start. Passing it through
    // failed the whole request, and every column sharing that query went blank with no error.
    const from = usageStatsFrom([0], now)

    expect(now - from).toBeLessThan(AI_USAGE_RECORD_MAX_RANGE_DAYS * DAY)
  })

  it('keeps a recent period start rather than widening it to the cap', () => {
    const yesterday = now - DAY

    expect(usageStatsFrom([yesterday], now)).toBe(yesterday)
  })

  it('covers the earliest period when several are declared', () => {
    const lastMonth = now - 30 * DAY

    expect(usageStatsFrom([now - DAY, lastMonth, now - 7 * DAY], now)).toBe(lastMonth)
  })

  it('falls back to the cap when asked with nothing to cover', () => {
    expect(now - usageStatsFrom([], now)).toBeLessThan(AI_USAGE_RECORD_MAX_RANGE_DAYS * DAY)
  })
})
