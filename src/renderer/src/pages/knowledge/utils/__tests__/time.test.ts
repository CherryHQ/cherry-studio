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
})
