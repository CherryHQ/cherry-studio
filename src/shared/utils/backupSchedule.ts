import type { BackupScheduleEntry } from '@shared/data/preference/preferenceTypes'

export const MAX_BACKUP_SCHEDULE_ENTRIES = 10

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/
const DAYS_IN_WEEK = 7

export const isValidScheduleTime = (time: string): boolean => TIME_PATTERN.test(time)

const occursOn = (entry: BackupScheduleEntry, weekday: number): boolean =>
  entry.days.length === 0 || entry.days.includes(weekday)

/** Slot instants of `entries` falling on the local calendar day that is `offsetDays` after `from`'s day. */
function slotsOnDay(entries: BackupScheduleEntry[], from: Date, offsetDays: number): number[] {
  const slots: number[] = []
  for (const entry of entries) {
    const match = TIME_PATTERN.exec(entry.time)
    if (!match) continue
    const date = new Date(
      from.getFullYear(),
      from.getMonth(),
      from.getDate() + offsetDays,
      Number(match[1]),
      Number(match[2])
    )
    if (occursOn(entry, date.getDay())) slots.push(date.getTime())
  }
  return slots
}

/** First scheduled instant strictly after `from`, or null when no entry can ever fire. */
export function getNextScheduledTime(entries: BackupScheduleEntry[], from: number): number | null {
  const base = new Date(from)
  for (let offset = 0; offset <= DAYS_IN_WEEK; offset++) {
    const upcoming = slotsOnDay(entries, base, offset).filter((slot) => slot > from)
    if (upcoming.length > 0) return Math.min(...upcoming)
  }
  return null
}

/** Latest scheduled instant at or before `from`, or null when none within the past week. */
export function getPreviousScheduledTime(entries: BackupScheduleEntry[], from: number): number | null {
  const base = new Date(from)
  for (let offset = 0; offset >= -DAYS_IN_WEEK; offset--) {
    const past = slotsOnDay(entries, base, offset).filter((slot) => slot <= from)
    if (past.length > 0) return Math.max(...past)
  }
  return null
}

/** Whether the latest backup predates the most recent scheduled slot, i.e. a slot was missed. */
export function hasMissedScheduledTime(entries: BackupScheduleEntry[], lastBackupTime: number | null, now: number) {
  const previous = getPreviousScheduledTime(entries, now)
  return previous !== null && (lastBackupTime === null || lastBackupTime < previous)
}
