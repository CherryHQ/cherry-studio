import type { Trigger } from '@shared/data/api/schemas/jobs'

/** The schedule presets the task form offers; any other cron expression is `cron`. */
export type ScheduleKind = 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'interval' | 'once' | 'cron'

export type ScheduleTriggerState = {
  kind: ScheduleKind
  value: string
  weekday: string
}

export const formatTimes = (hours: string[], minute: string) =>
  [...new Set(hours)]
    .sort()
    .map((hour) => `${hour}:${minute}`)
    .join(',')

export function triggerToFormState(trigger: Trigger): ScheduleTriggerState {
  if (trigger.kind === 'interval') {
    return {
      kind: 'interval',
      value: String(Math.max(1, Math.round(trigger.ms / 60_000))),
      weekday: '1'
    }
  }

  if (trigger.kind === 'once') {
    return {
      kind: 'once',
      value: new Date(trigger.at).toISOString(),
      weekday: '1'
    }
  }

  const parts = trigger.expr.trim().split(/\s+/)
  if (parts.length !== 5) {
    return { kind: 'cron', value: trigger.expr, weekday: '1' }
  }

  const [minutePart, hourPart, dayOfMonth, month, dayOfWeek] = parts
  if (minutePart === '0' && hourPart === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return { kind: 'hourly', value: '', weekday: '1' }
  }

  const minute = Number(minutePart)
  const hourParts = hourPart.split(',')
  const hasValidTime =
    Number.isInteger(minute) &&
    minute >= 0 &&
    minute <= 59 &&
    hourParts.every((part) => /^\d{1,2}$/.test(part) && Number(part) <= 23)

  if (!hasValidTime || dayOfMonth !== '*' || month !== '*') {
    return { kind: 'cron', value: trigger.expr, weekday: '1' }
  }

  // Canonical form: sorted, deduped (matches parseTimes/formatTimes so the UI
  // multi-select never disagrees with the value it renders).
  const value = formatTimes(
    hourParts.map((part) => part.padStart(2, '0')),
    String(minute).padStart(2, '0')
  )
  if (dayOfWeek === '*') return { kind: 'daily', value, weekday: '1' }
  if (dayOfWeek === '1-5') return { kind: 'weekdays', value, weekday: '1' }
  if (/^[0-6]$/.test(dayOfWeek)) return { kind: 'weekly', value, weekday: dayOfWeek }
  return { kind: 'cron', value: trigger.expr, weekday: '1' }
}
