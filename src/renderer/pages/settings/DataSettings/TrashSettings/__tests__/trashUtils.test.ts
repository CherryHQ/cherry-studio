import { describe, expect, it } from 'vitest'

import { computeDaysRemaining, formatDeletedTime, runPerItem, toEpochMs } from '../trashUtils'

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

  it('distinguishes a positive remainder below one day from an expired item', () => {
    expect(computeDaysRemaining(now - 30 * DAY + DAY / 2, 30, now)).toBe('less-than-day')
  })

  it('returns 1 when exactly one day remains', () => {
    expect(computeDaysRemaining(now - 29 * DAY, 30, now)).toBe(1)
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

  it('degrades to em dash when invalid', () => {
    expect(formatDeletedTime(Number.NaN)).toBe('—')
  })
})

describe('runPerItem', () => {
  it('commits items in order and reports exact successes and failures', async () => {
    const calls: string[] = []
    const items = [
      { id: 'first', name: 'First', deletedAt: 1 },
      { id: 'stale', name: 'Stale', deletedAt: 2 },
      { id: 'last', name: 'Last', deletedAt: 3 }
    ]

    const outcome = await runPerItem(items, async (item) => {
      calls.push(item.id)
      if (item.id === 'stale') throw new Error('no longer in trash')
    })

    expect(calls).toEqual(['first', 'stale', 'last'])
    expect(outcome).toEqual({
      succeeded: ['first', 'last'],
      failed: [{ id: 'stale', error: 'no longer in trash' }]
    })
  })

  it('formats non-Error rejection values for user feedback', async () => {
    const [item] = [{ id: 'first', name: 'First', deletedAt: 1 }]

    const outcome = await runPerItem([item], async () => {
      throw 'unavailable'
    })

    expect(outcome).toEqual({
      succeeded: [],
      failed: [{ id: 'first', error: 'Error Details:\n  "unavailable"' }]
    })
  })
})
