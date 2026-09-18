import { beforeEach, describe, expect, it, vi } from 'vitest'

import { forecastQuotaExhaustion, periodRenewsAt, periodStartOf } from '../apiKeyLimit'

describe('periodStartOf', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('total always returns 0', () => {
    vi.setSystemTime(new Date('2026-09-18T14:30:00Z'))
    expect(periodStartOf('total')).toBe(0)
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
