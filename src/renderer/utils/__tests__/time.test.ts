import { describe, expect, it } from 'vitest'

import { createDurationFormatter, formatRelativeTime, getLocaleFirstDayOfWeek } from '../time'

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

  it('switches to months and years instead of counting hundreds of days', () => {
    expect(formatRelativeTime('2026-01-22T12:00:00Z', 'en-US', NOW)).toBe('3 months ago')
    expect(formatRelativeTime('2024-04-22T12:00:00Z', 'en-US', NOW)).toBe('2 years ago')
  })

  it('picks the same unit for equal distances in either direction', () => {
    // Math.round breaks ties toward +infinity, so a signed threshold put -11.5 months on `month` and
    // +11.5 months on `year`.
    const days = (n: number) => n * 86400000
    expect(formatRelativeTime(new Date(NOW - days(345)).toISOString(), 'en-US', NOW)).toBe('last year')
    expect(formatRelativeTime(new Date(NOW + days(345)).toISOString(), 'en-US', NOW)).toBe('next year')
    expect(formatRelativeTime(new Date(NOW - days(29.5)).toISOString(), 'en-US', NOW)).toBe('last month')
    expect(formatRelativeTime(new Date(NOW + days(29.5)).toISOString(), 'en-US', NOW)).toBe('next month')
  })

  it('leaves no gap between the day, month and year units', () => {
    const daysAgo = (days: number) => new Date(NOW - days * 86400000).toISOString()
    // 29 days is still day-level; 30 must already read as a month, never "30 days ago".
    expect(formatRelativeTime(daysAgo(29), 'en-US', NOW)).toBe('29 days ago')
    expect(formatRelativeTime(daysAgo(30), 'en-US', NOW)).toBe('last month')
    // 360 days rounds to 12 months, which must roll up rather than read "12 months ago".
    expect(formatRelativeTime(daysAgo(360), 'en-US', NOW)).toBe('last year')
  })
})

describe('createDurationFormatter', () => {
  it('formats units and decimal separators for the requested locale', () => {
    expect(createDurationFormatter('de-DE')(1_200)).toBe('1,2 Sek.')
    expect(createDurationFormatter('zh-CN')(61_200)).toBe('1分钟1.2秒')
  })

  it('carries rounded seconds into the next minute', () => {
    expect(createDurationFormatter('en-US')(119_960)).toBe('2m 0s')
  })
})

describe('getLocaleFirstDayOfWeek', () => {
  it('uses locale calendar metadata', () => {
    expect(getLocaleFirstDayOfWeek('en-US')).toBe(0)
    expect(getLocaleFirstDayOfWeek('zh-CN')).toBe(1)
  })
})
