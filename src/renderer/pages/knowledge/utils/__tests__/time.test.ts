import { describe, expect, it } from 'vitest'

import { formatRelativeTime } from '..'

const NOW = new Date('2026-04-22T12:00:00Z').getTime()

describe('formatRelativeTime', () => {
  it('formats minute-level differences within one hour', () => {
    expect(formatRelativeTime('2026-04-22T11:58:00Z', 'en-US', NOW)).toBe('2 minutes ago')
  })

  it('formats hour-level differences within one day', () => {
    expect(formatRelativeTime('2026-04-22T15:00:00Z', 'en-US', NOW)).toBe('in 3 hours')
  })

  it('formats day-level differences beyond one day', () => {
    expect(formatRelativeTime('2026-04-20T12:00:00Z', 'en-US', NOW)).toBe('2 days ago')
  })

  it('rolls a sub-hour value up to the next unit at the boundary', () => {
    // 59m54s ago rounds to 60 minutes -> must read "1 hour ago", not "60 minutes ago"
    expect(formatRelativeTime(new Date(NOW - 3594000).toISOString(), 'en-US', NOW)).toBe('1 hour ago')
    // 59m54s in the future likewise rolls up to "in 1 hour"
    expect(formatRelativeTime(new Date(NOW + 3594000).toISOString(), 'en-US', NOW)).toBe('in 1 hour')
  })

  it('rolls a sub-day value up to days at the hour boundary', () => {
    // 23h59m ago rounds to 24 hours -> must read "yesterday", not "24 hours ago"
    const almostADay = 23 * 3600000 + 59 * 60000
    expect(formatRelativeTime(new Date(NOW - almostADay).toISOString(), 'en-US', NOW)).toBe('yesterday')
  })
})
