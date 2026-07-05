import { describe, expect, it } from 'vitest'

import { computeDaysRemaining, formatDeletedTime, toEpochMs } from '../trashUtils'

const DAY = 24 * 60 * 60 * 1000

describe('computeDaysRemaining', () => {
  const now = 1_750_000_000_000

  it('returns null when retention is 0 (keep forever)', () => {
    expect(computeDaysRemaining(now - DAY, 0, now)).toBeNull()
  })

  it('returns null when deletedAt is missing', () => {
    expect(computeDaysRemaining(undefined, 30, now)).toBeNull()
  })

  it('clamps expired items to 0', () => {
    expect(computeDaysRemaining(now - 31 * DAY, 30, now)).toBe(0)
  })

  it('ceils a partial day to 1', () => {
    expect(computeDaysRemaining(now - 30 * DAY + DAY / 2, 30, now)).toBe(1)
  })

  it('returns full retention days for a fresh delete', () => {
    expect(computeDaysRemaining(now, 30, now)).toBe(30)
  })
})

describe('toEpochMs', () => {
  it('parses ISO datetime strings', () => {
    expect(toEpochMs('2026-07-04T00:00:00.000Z')).toBe(Date.parse('2026-07-04T00:00:00.000Z'))
  })

  it('passes through epoch numbers', () => {
    expect(toEpochMs(1_750_000_000_000)).toBe(1_750_000_000_000)
  })

  it('returns undefined for undefined', () => {
    expect(toEpochMs(undefined)).toBeUndefined()
  })

  it('returns undefined for unparseable strings', () => {
    expect(toEpochMs('not-a-date')).toBeUndefined()
  })
})

describe('formatDeletedTime', () => {
  it('formats as YYYY-MM-DD HH:mm', () => {
    const ms = new Date(2026, 6, 4, 9, 5).getTime()
    expect(formatDeletedTime(ms)).toBe('2026-07-04 09:05')
  })

  it('degrades to em dash when missing', () => {
    expect(formatDeletedTime(undefined)).toBe('—')
  })
})
