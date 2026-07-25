import type { UsageLedgerTimelineBucket } from '@shared/data/api/schemas/usageLedger'
import { describe, expect, it } from 'vitest'

import { getTimelinePoints } from '../UsageSettings'

function bucket(date: string, totalTokens: number): UsageLedgerTimelineBucket {
  return {
    date,
    costCurrency: 'USD',
    totalTokens,
    totalNoCacheTokens: totalTokens,
    totalCacheReadTokens: 0,
    totalCacheWriteTokens: 0,
    totalCost: 0,
    entryCount: 1
  }
}

const getTokens = (value: UsageLedgerTimelineBucket) => value.totalTokens

describe('getTimelinePoints', () => {
  it('fills gap days with zero and keeps calendar order', () => {
    const from = new Date(2026, 2, 1).getTime()
    const to = new Date(2026, 2, 4, 23, 59, 59, 999).getTime()

    expect(getTimelinePoints([bucket('2026-03-03', 42)], { from, to }, getTokens)).toEqual([
      { date: '2026-03-01', value: 0 },
      { date: '2026-03-02', value: 0 },
      { date: '2026-03-03', value: 42 },
      { date: '2026-03-04', value: 0 }
    ])
  })

  it('steps by calendar day across a DST transition', () => {
    // 2026-11-01 is the US fall-back day (25h long in America/New_York).
    const from = new Date(2026, 9, 30).getTime()
    const to = new Date(2026, 10, 3, 23, 59, 59, 999).getTime()
    const dates = getTimelinePoints([], { from, to }, getTokens).map((point) => point.date)

    expect(dates).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03'])
    expect(new Set(dates).size).toBe(dates.length)
  })

  it('passes buckets through when the range is unbounded', () => {
    expect(getTimelinePoints([bucket('2026-03-03', 7), bucket('2026-03-09', 9)], {}, getTokens)).toEqual([
      { date: '2026-03-03', value: 7 },
      { date: '2026-03-09', value: 9 }
    ])
  })
})
