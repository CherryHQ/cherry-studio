import { describe, expect, it } from 'vitest'

import { isInsideQuietHours, localDayKey, minutesOfDay } from '../reminderTime'

describe('English learning reminder time', () => {
  it('parses valid local clock values and rejects malformed values', () => {
    expect(minutesOfDay('19:30')).toBe(19 * 60 + 30)
    expect(minutesOfDay('24:00')).toBeNull()
    expect(minutesOfDay('9:30')).toBeNull()
  })

  it('handles quiet hours that cross midnight', () => {
    const start = minutesOfDay('22:00')!
    const end = minutesOfDay('08:00')!

    expect(isInsideQuietHours(minutesOfDay('23:00')!, start, end)).toBe(true)
    expect(isInsideQuietHours(minutesOfDay('07:59')!, start, end)).toBe(true)
    expect(isInsideQuietHours(minutesOfDay('08:00')!, start, end)).toBe(false)
    expect(isInsideQuietHours(minutesOfDay('19:00')!, start, end)).toBe(false)
  })

  it('uses the local calendar date as the notification deduplication key', () => {
    expect(localDayKey(new Date(2026, 6, 8, 23, 30))).toBe('2026-07-08')
  })
})
