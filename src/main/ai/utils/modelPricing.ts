import type { ScheduledModelPricing } from '@cherrystudio/provider-registry'
import type { RuntimeModelPricing } from '@shared/data/types/model'

type PricingOverride = NonNullable<ScheduledModelPricing['default']>
type PricingSchedule = ScheduledModelPricing['rules'][number]['schedule']

const WEEKDAY_INDEX = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6
} as const

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

function getZonedClock(date: Date, timezone: string): { day: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const weekday = values.weekday?.toLowerCase() as keyof typeof WEEKDAY_INDEX
  return { day: WEEKDAY_INDEX[weekday], minute: Number(values.hour) * 60 + Number(values.minute) }
}

function matchesWeeklySchedule(schedule: Extract<PricingSchedule, { kind: 'weekly' }>, at: Date): boolean {
  const clock = getZonedClock(at, schedule.timezone)
  const days = new Set<number>(schedule.daysOfWeek.map((day) => WEEKDAY_INDEX[day]))
  if (schedule.startTime === undefined || schedule.endTime === undefined) return days.has(clock.day)

  const start = timeToMinutes(schedule.startTime)
  const end = timeToMinutes(schedule.endTime)
  if (start < end) return days.has(clock.day) && clock.minute >= start && clock.minute < end

  const previousDay = (clock.day + 6) % 7
  return (days.has(clock.day) && clock.minute >= start) || (days.has(previousDay) && clock.minute < end)
}

function matchesSchedule(schedule: PricingSchedule, at: Date): boolean {
  if (schedule.kind === 'weekly') return matchesWeeklySchedule(schedule, at)
  const timestamp = at.getTime()
  return timestamp >= Date.parse(schedule.startsAt) && timestamp < Date.parse(schedule.endsAt)
}

function applyOverride(pricing: RuntimeModelPricing, override: PricingOverride): RuntimeModelPricing {
  return { ...pricing, ...override }
}

export function resolveModelPricing(pricing: RuntimeModelPricing, at: Date): RuntimeModelPricing {
  if (!pricing.scheduled) return pricing

  let resolved = pricing.scheduled.default ? applyOverride(pricing, pricing.scheduled.default) : pricing
  for (const rule of pricing.scheduled.rules) {
    if (matchesSchedule(rule.schedule, at)) resolved = applyOverride(resolved, rule.pricing)
  }
  return resolved
}
