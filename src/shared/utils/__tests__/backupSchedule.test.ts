import { describe, expect, it } from 'vitest'

import {
  getNextScheduledTime,
  getPreviousScheduledTime,
  hasMissedScheduledTime,
  isValidScheduleTime
} from '../backupSchedule'

const WEEKDAYS = [1, 2, 3, 4, 5]
// 2026-11-03 is a Tuesday; 2026-11-01 a Sunday (local time)
const at = (day: number, hh: number, mm = 0) => new Date(2026, 10, day, hh, mm).getTime()

describe('backupSchedule', () => {
  it('validates HH:mm times', () => {
    expect(isValidScheduleTime('08:30')).toBe(true)
    expect(isValidScheduleTime('24:00')).toBe(false)
    expect(isValidScheduleTime('8:30')).toBe(false)
  })

  it('picks the next slot later the same day, then rolls to the next matching day', () => {
    const entries = [{ time: '17:30', days: WEEKDAYS }]
    expect(getNextScheduledTime(entries, at(3, 9))).toBe(at(3, 17, 30))
    expect(getNextScheduledTime(entries, at(3, 17, 30))).toBe(at(4, 17, 30))
    // Friday evening -> Monday
    expect(getNextScheduledTime(entries, at(6, 18))).toBe(at(9, 17, 30))
  })

  it('mixes entries and honours weekday filters', () => {
    const entries = [
      { time: '08:30', days: WEEKDAYS },
      { time: '22:00', days: [] }
    ]
    expect(getNextScheduledTime(entries, at(1, 9))).toBe(at(1, 22))
    expect(getNextScheduledTime(entries, at(1, 22))).toBe(at(2, 8, 30))
  })

  it('returns null without usable entries', () => {
    expect(getNextScheduledTime([], at(3, 9))).toBeNull()
    expect(getNextScheduledTime([{ time: 'bad', days: [] }], at(3, 9))).toBeNull()
    expect(getPreviousScheduledTime([], at(3, 9))).toBeNull()
  })

  it('finds the previous slot across a weekend', () => {
    expect(getPreviousScheduledTime([{ time: '17:30', days: WEEKDAYS }], at(9, 9))).toBe(at(6, 17, 30))
  })

  it('detects a single missed slot only when the last backup is older', () => {
    const friday = at(6, 17, 30)
    const weekdayEvening = [{ time: '17:30', days: WEEKDAYS }]
    // Monday 09:00, last backup Friday 17:30 -> nothing missed
    expect(hasMissedScheduledTime(weekdayEvening, friday, at(9, 9))).toBe(false)
    const withMorning = [...weekdayEvening, { time: '08:30', days: WEEKDAYS }]
    expect(hasMissedScheduledTime(withMorning, friday, at(9, 9))).toBe(true)
    expect(hasMissedScheduledTime(withMorning, at(9, 8, 45), at(9, 9))).toBe(false)
    expect(hasMissedScheduledTime(withMorning, null, at(9, 9))).toBe(true)
  })
})
