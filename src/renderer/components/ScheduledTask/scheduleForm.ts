import { Cron } from 'croner'
import type { TFunction } from 'i18next'

import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'
import type { Trigger } from '@shared/data/api/schemas/jobs'
import type { ScheduledTaskEntity } from '@shared/data/types/agent'

export type ScheduleKind = 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'interval' | 'once' | 'cron'
export type ScheduleFormState = {
  kind: ScheduleKind
  value: string
  weekday: string
  timeoutMinutes: string
}

export type TaskDraftSnapshot = {
  name: string
  prompt: string
  schedule: ScheduleFormState
  channelIds: string[]
  workspaceId: string | null
  reuseSession: boolean
}

export const DEFAULT_SCHEDULE: ScheduleFormState = {
  kind: 'daily',
  value: '09:00',
  weekday: '1',
  timeoutMinutes: ''
}

export const parseScheduleDate = (value: string) => {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

// Canonical value for the time presets: a sorted, deduped 'HH:MM,HH:MM…' list
// sharing one minute — per-entry minutes would cross-product into extra cron firings.
export const parseTimes = (value: string): { hours: string[]; minute: string } | null => {
  const matches = value.split(',').map((part) => /^(\d{1,2}):(\d{2})$/.exec(part.trim()))
  if (matches.some((match) => match === null)) return null

  const minute = matches[0]![2]
  if (Number(minute) > 59 || matches.some((match) => match![2] !== minute)) return null

  const hours = matches.map((match) => Number(match![1]))
  if (hours.some((hour) => hour > 23)) return null

  const uniqueSorted = [...new Set(hours)].sort((a, b) => a - b)
  return { hours: uniqueSorted.map((hour) => String(hour).padStart(2, '0')), minute }
}

export const formatTimes = (hours: string[], minute: string) =>
  [...new Set(hours)]
    .sort()
    .map((hour) => `${hour}:${minute}`)
    .join(',')

function isValidCronExpression(value: string): boolean {
  const expression = value.trim()

  let cron: Cron | undefined
  try {
    cron = new Cron(expression, { paused: true })
    return cron.nextRun() !== null
  } catch {
    return false
  } finally {
    cron?.stop()
  }
}

export function triggerToFormState(trigger: Trigger): Omit<ScheduleFormState, 'timeoutMinutes'> {
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

export function formStateToTrigger(schedule: ScheduleFormState): Trigger | null {
  if (schedule.kind === 'hourly') return { kind: 'cron', expr: '0 * * * *' }

  if (schedule.kind === 'interval') {
    const minutes = Number(schedule.value.trim())
    if (!Number.isInteger(minutes) || minutes <= 0) return null
    return { kind: 'interval', ms: minutes * 60_000 }
  }

  if (schedule.kind === 'once') {
    const at = Date.parse(schedule.value.trim())
    return Number.isFinite(at) ? { kind: 'once', at } : null
  }

  if (schedule.kind === 'cron') {
    const expr = schedule.value.trim()
    return isValidCronExpression(expr) ? { kind: 'cron', expr } : null
  }

  const times = parseTimes(schedule.value)
  if (!times || times.hours.length === 0) return null
  const prefix = `${Number(times.minute)} ${times.hours.map(Number).join(',')} * *`

  if (schedule.kind === 'daily') return { kind: 'cron', expr: `${prefix} *` }
  if (schedule.kind === 'weekdays') return { kind: 'cron', expr: `${prefix} 1-5` }
  if (!/^[0-6]$/.test(schedule.weekday)) return null
  return { kind: 'cron', expr: `${prefix} ${schedule.weekday}` }
}

export function scheduleForKind(kind: ScheduleKind, current: ScheduleFormState): ScheduleFormState {
  switch (kind) {
    case 'hourly':
      return { ...current, kind, value: '' }
    case 'daily':
    case 'weekdays':
    case 'weekly':
      return { ...current, kind, value: parseTimes(current.value) ? current.value : '09:00' }
    case 'interval':
    case 'once':
    case 'cron':
      return { ...current, kind, value: '' }
  }
}

export function taskToDraftSnapshot(task: ScheduledTaskEntity): TaskDraftSnapshot {
  return {
    name: task.name,
    prompt: task.prompt,
    schedule: {
      ...triggerToFormState(task.trigger),
      timeoutMinutes: task.timeoutMinutes > 0 ? task.timeoutMinutes.toString() : ''
    },
    channelIds: task.channelIds ?? [],
    workspaceId: task.workspace.type === AGENT_WORKSPACE_TYPE.USER ? task.workspace.workspaceId : null,
    reuseSession: task.reuseSession
  }
}

export function scheduleInputsEqual(a: ScheduleFormState, b: ScheduleFormState): boolean {
  return a.kind === b.kind && a.value === b.value && a.weekday === b.weekday
}

export function stringArraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

export function triggersEqual(a: Trigger, b: Trigger): boolean {
  if (a.kind === 'cron' && b.kind === 'cron') {
    return a.expr === b.expr && a.timezone === b.timezone && a.limit === b.limit
  }
  if (a.kind === 'interval' && b.kind === 'interval') return a.ms === b.ms && a.anchor === b.anchor
  if (a.kind === 'once' && b.kind === 'once') return a.at === b.at
  return false
}

export function preserveCompatibleTriggerMetadata(previous: Trigger, next: Trigger): Trigger {
  if (previous.kind === 'cron' && next.kind === 'cron') {
    return { ...previous, expr: next.expr }
  }
  if (previous.kind === 'interval' && next.kind === 'interval') {
    return { ...previous, ms: next.ms }
  }
  return next
}

export function getWeekdayLabel(weekday: string, t: TFunction) {
  const labels: Record<string, string> = {
    '0': t('agent.tasks.schedule.weekdays.sunday'),
    '1': t('agent.tasks.schedule.weekdays.monday'),
    '2': t('agent.tasks.schedule.weekdays.tuesday'),
    '3': t('agent.tasks.schedule.weekdays.wednesday'),
    '4': t('agent.tasks.schedule.weekdays.thursday'),
    '5': t('agent.tasks.schedule.weekdays.friday'),
    '6': t('agent.tasks.schedule.weekdays.saturday')
  }
  return labels[weekday] ?? weekday
}

export function getTriggerSummary(trigger: Trigger, t: TFunction) {
  const schedule = triggerToFormState(trigger)
  // Time presets may hold a comma-joined list; space it out for display.
  const time = schedule.value.split(',').join(', ')
  switch (schedule.kind) {
    case 'hourly':
      return t('agent.tasks.schedule.summary.hourly')
    case 'daily':
      return t('agent.tasks.schedule.summary.daily', { time })
    case 'weekdays':
      return t('agent.tasks.schedule.summary.weekdays', { time })
    case 'weekly':
      return t('agent.tasks.schedule.summary.weekly', {
        weekday: getWeekdayLabel(schedule.weekday, t),
        time
      })
    case 'interval':
      return t('agent.tasks.schedule.summary.interval', { count: Number(schedule.value) })
    case 'once':
      return new Date(schedule.value).toLocaleString()
    case 'cron':
      return schedule.value
  }
}
