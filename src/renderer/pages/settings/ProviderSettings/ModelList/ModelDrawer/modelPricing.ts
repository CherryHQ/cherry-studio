import type { Currency, Model, RuntimeModelPricing } from '@shared/data/types/model'
import { RuntimeModelPricingSchema } from '@shared/data/types/model'
import {
  compileModelPricingPolicy,
  normalizeModelPricing,
  resolveModelPricing,
  type TokenPricing
} from '@shared/utils/modelPricing'
import { isEqual } from 'es-toolkit'

type ModelPricing = NonNullable<Model['pricing']>
type PricingField = 'input' | 'output' | 'cacheRead' | 'cacheWrite'

export const MODEL_PRICING_CURRENCY_SYMBOLS = ['$', '¥'] as const
export type ModelPricingCurrencySymbol = (typeof MODEL_PRICING_CURRENCY_SYMBOLS)[number]
export type PricingMetric = PricingField

export interface PricingRatesDraft {
  input: string
  output: string
  cacheRead: string
  cacheWrite: string
}

export interface PricingTimeRangeDraft {
  start: string
  end: string
}

export interface ModelPricingRuleDraft {
  id: string
  minInputTokens: string
  timezone: string
  startsAt: string
  endsAt: string
  cron: string
  editor: 'visual' | 'advanced'
  weekdays: number[]
  ranges: PricingTimeRangeDraft[]
  pricing: PricingRatesDraft
}

export interface ModelPricingDraft {
  currency: ModelPricingCurrencySymbol
  base: PricingRatesDraft
  rules: ModelPricingRuleDraft[]
  perImage?: ModelPricing['perImage']
  perMinute?: ModelPricing['perMinute']
}

export interface ModelPricingDraftErrors {
  base: Partial<Record<PricingField, string>>
  rules: Array<Record<string, string>>
}

export interface DraftParseResult {
  pricing?: RuntimeModelPricing
  errors: ModelPricingDraftErrors
  firstInvalidRuleIndex?: number
}

const SYMBOL_TO_CURRENCY: Record<ModelPricingCurrencySymbol, Currency> = { $: 'USD', '¥': 'CNY' }
const CURRENCY_TO_SYMBOL: Record<Currency, ModelPricingCurrencySymbol> = { USD: '$', CNY: '¥' }
const DEFAULT_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

function rateValue(rate: { perMillionTokens: number | null } | undefined): string {
  return rate?.perMillionTokens == null ? '' : String(rate.perMillionTokens)
}

function ratesDraft(rates: Partial<TokenPricing>, requireBase = false): PricingRatesDraft {
  return {
    input: rateValue(rates.input) || (requireBase ? '0' : ''),
    output: rateValue(rates.output) || (requireBase ? '0' : ''),
    cacheRead: rateValue(rates.cacheRead),
    cacheWrite: rateValue(rates.cacheWrite)
  }
}

function ruleId(index: number): string {
  return `pricing-rule-${index}-${crypto.randomUUID()}`
}

function cronValues(value: string, minimum: number, maximum: number): number[] | null {
  if (value === '*') return Array.from({ length: maximum - minimum + 1 }, (_, index) => minimum + index)
  const result = new Set<number>()
  for (const part of value.split(',')) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(part)
    if (!match) return null
    const start = Number(match[1])
    const end = match[2] === undefined ? start : Number(match[2])
    if (start < minimum || end > maximum || start > end) return null
    for (let current = start; current <= end; current++) result.add(current)
  }
  return [...result]
}

function cronMinuteGrid(expressions: string[]): boolean[][] | null {
  const grid = Array.from({ length: 7 }, () => Array<boolean>(24 * 60).fill(false))
  for (const expression of expressions) {
    const fields = expression.trim().split(/\s+/)
    if (fields.length !== 5 || fields[2] !== '*' || fields[3] !== '*') return null
    const minutes = cronValues(fields[0], 0, 59)
    const hours = cronValues(fields[1], 0, 23)
    const weekdays = cronValues(fields[4], 0, 7)?.map((day) => day % 7)
    if (!minutes || !hours || !weekdays) return null
    for (const weekday of weekdays) {
      for (const hour of hours) {
        for (const minute of minutes) grid[weekday][hour * 60 + minute] = true
      }
    }
  }
  return grid
}

function sameMinuteGrid(left: boolean[][] | null, right: boolean[][] | null): boolean {
  return Boolean(
    left &&
      right &&
      left.every((day, dayIndex) => day.every((value, minuteIndex) => value === right[dayIndex][minuteIndex]))
  )
}

export function parseVisualCronExpressions(
  expressions: string[]
): { weekdays: number[]; ranges: PricingTimeRangeDraft[] } | null {
  const grid = cronMinuteGrid(expressions)
  if (!grid) return null
  const activeDays = grid.map((day, index) => (day.some(Boolean) ? index : -1)).filter((day) => day >= 0)
  if (activeDays.length === 0) return null
  const pattern = grid[activeDays[0]]
  if (activeDays.some((day) => !pattern.every((value, minute) => value === grid[day][minute]))) return null

  const ranges: PricingTimeRangeDraft[] = []
  for (let minute = 0; minute < pattern.length; ) {
    if (!pattern[minute]) {
      minute++
      continue
    }
    const start = minute
    while (minute < pattern.length && pattern[minute]) minute++
    if (minute === pattern.length) return null
    ranges.push({ start: minuteClock(start), end: minuteClock(minute) })
  }
  const weekdays = activeDays.map((day) => (day === 0 ? 7 : day)).sort((left, right) => left - right)
  return sameMinuteGrid(grid, cronMinuteGrid(buildVisualCronExpressions(weekdays, ranges)))
    ? { weekdays, ranges }
    : null
}

export function createModelPricingDraft(pricing: Model['pricing']): ModelPricingDraft {
  const source: RuntimeModelPricing = pricing ?? {
    input: { perMillionTokens: 0, currency: 'USD' },
    output: { perMillionTokens: 0, currency: 'USD' }
  }
  const canonical = normalizeModelPricing(source)
  const currency = canonical.input.currency ?? canonical.output.currency ?? 'USD'
  return {
    currency: CURRENCY_TO_SYMBOL[currency],
    base: ratesDraft(canonical, true),
    rules: canonical.rules.map((rule, index) => {
      const expressions = rule.when.time?.cron ?? []
      const visualSchedule = expressions.length ? parseVisualCronExpressions(expressions) : null
      return {
        id: ruleId(index),
        minInputTokens: rule.when.minInputTokens === undefined ? '' : String(rule.when.minInputTokens),
        timezone: rule.when.time?.timezone ?? DEFAULT_TIMEZONE,
        startsAt: rule.when.time?.startsAt ?? '',
        endsAt: rule.when.time?.endsAt ?? '',
        cron: expressions.join('\n'),
        editor: visualSchedule ? 'visual' : 'advanced',
        weekdays: visualSchedule?.weekdays ?? [1, 2, 3, 4, 5],
        ranges: visualSchedule?.ranges ?? [{ start: '09:00', end: '17:00' }],
        pricing: ratesDraft(rule.pricing)
      }
    }),
    ...(canonical.perImage ? { perImage: canonical.perImage } : {}),
    ...(canonical.perMinute ? { perMinute: canonical.perMinute } : {})
  }
}

export function createPricingRuleDraft(template: 'empty' | 'tier' | 'time', index: number): ModelPricingRuleDraft {
  return {
    id: ruleId(index),
    minInputTokens: template === 'tier' ? '100000' : '',
    timezone: DEFAULT_TIMEZONE,
    startsAt: '',
    endsAt: '',
    cron: '',
    editor: template === 'time' ? 'visual' : 'advanced',
    weekdays: [1, 2, 3, 4, 5],
    ranges: [{ start: '09:00', end: '17:00' }],
    pricing: { input: '', output: '', cacheRead: '', cacheWrite: '' }
  }
}

function cronSegment(startMinute: number, endMinute: number, weekdays: string): string[] {
  if (startMinute >= endMinute) return []
  const firstHour = Math.floor(startMinute / 60)
  const lastHour = Math.floor((endMinute - 1) / 60)
  const firstMinute = startMinute % 60
  const endRemainder = endMinute % 60
  if (firstHour === lastHour) {
    const lastMinute = (endMinute - 1) % 60
    const minutes =
      firstMinute === 0 && lastMinute === 59
        ? '*'
        : firstMinute === lastMinute
          ? firstMinute
          : `${firstMinute}-${lastMinute}`
    return [`${minutes} ${firstHour} * * ${weekdays}`]
  }
  const expressions: string[] = []
  if (firstMinute > 0) expressions.push(`${firstMinute}-59 ${firstHour} * * ${weekdays}`)
  const fullStartHour = firstHour + (firstMinute > 0 ? 1 : 0)
  const fullEndHour = lastHour - (endRemainder > 0 ? 1 : 0)
  if (fullStartHour <= fullEndHour) {
    expressions.push(
      `* ${fullStartHour === fullEndHour ? fullStartHour : `${fullStartHour}-${fullEndHour}`} * * ${weekdays}`
    )
  }
  if (endRemainder > 0)
    expressions.push(`${endRemainder === 1 ? 0 : `0-${endRemainder - 1}`} ${lastHour} * * ${weekdays}`)
  return expressions
}

function timeMinutes(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

function minuteClock(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
}

function shiftedWeekdays(days: number[]): number[] {
  return days.map((day) => (day + 1) % 7).sort((left, right) => left - right)
}

export function buildVisualCronExpressions(weekdays: number[], ranges: PricingTimeRangeDraft[]): string[] {
  if (weekdays.length === 0) return []
  const dayExpression = [...weekdays].sort((left, right) => left - right).join(',')
  const nextDayExpression = shiftedWeekdays(weekdays).join(',')
  return ranges.flatMap((range) => {
    const start = timeMinutes(range.start)
    const end = timeMinutes(range.end)
    if (start === null || end === null || start === end) return []
    return start < end
      ? cronSegment(start, end, dayExpression)
      : [...cronSegment(start, 24 * 60, dayExpression), ...cronSegment(0, end, nextDayExpression)]
  })
}

function parseRate(value: string, required: boolean): number | undefined {
  if (!value.trim() && !required) return undefined
  const parsed = Number(value)
  return value.trim() && Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function parseRates(
  draft: PricingRatesDraft,
  currency: Currency,
  required: boolean,
  errors: Record<string, string>
): Partial<TokenPricing> {
  const result: Partial<TokenPricing> = {}
  for (const field of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) {
    const value = parseRate(draft[field], required && (field === 'input' || field === 'output'))
    if (value === undefined) {
      if (draft[field].trim() || (required && (field === 'input' || field === 'output')))
        errors[field] = 'invalid-price'
    } else {
      result[field] = { perMillionTokens: value, currency }
    }
  }
  return result
}

export function parseModelPricingDraft(draft: ModelPricingDraft): DraftParseResult {
  const errors: ModelPricingDraftErrors = { base: {}, rules: draft.rules.map(() => ({})) }
  const currency = SYMBOL_TO_CURRENCY[draft.currency]
  const base = parseRates(draft.base, currency, true, errors.base)
  const rules: NonNullable<RuntimeModelPricing['rules']> = []

  for (const [index, rule] of draft.rules.entries()) {
    const ruleErrors = errors.rules[index]
    const threshold = rule.minInputTokens.trim() ? Number(rule.minInputTokens) : undefined
    if (threshold !== undefined && (!Number.isSafeInteger(threshold) || threshold <= 0)) {
      ruleErrors.minInputTokens = 'invalid-threshold'
    }
    const existingCron = rule.cron
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    const visualCron = buildVisualCronExpressions(rule.weekdays, rule.ranges)
    const existingVisualSchedule = parseVisualCronExpressions(existingCron)
    const cron =
      rule.editor === 'visual'
        ? existingVisualSchedule &&
          isEqual(existingVisualSchedule, {
            weekdays: [...rule.weekdays].sort((left, right) => left - right),
            ranges: rule.ranges
          })
          ? existingCron
          : visualCron
        : existingCron
    const hasTime = cron.length > 0 || Boolean(rule.startsAt) || Boolean(rule.endsAt)
    if (rule.editor === 'visual') {
      if (rule.weekdays.length === 0) ruleErrors.weekdays = 'required'
      if (
        rule.ranges.length === 0 ||
        rule.ranges.some(
          (range) => timeMinutes(range.start) === null || timeMinutes(range.end) === null || range.start === range.end
        )
      ) {
        ruleErrors.ranges = 'invalid-time-range'
      }
    }
    if (threshold === undefined && !hasTime) ruleErrors.condition = 'required'

    const pricingErrors: Record<string, string> = {}
    const pricing = parseRates(rule.pricing, currency, false, pricingErrors)
    Object.assign(ruleErrors, pricingErrors)
    if (Object.keys(pricing).length === 0) ruleErrors.pricing = 'required'

    rules.push({
      when: {
        ...(threshold !== undefined ? { minInputTokens: threshold } : {}),
        ...(hasTime
          ? {
              time: {
                timezone: rule.timezone,
                ...(cron.length ? { cron } : {}),
                ...(rule.startsAt ? { startsAt: rule.startsAt } : {}),
                ...(rule.endsAt ? { endsAt: rule.endsAt } : {})
              }
            }
          : {})
      },
      pricing
    } as NonNullable<RuntimeModelPricing['rules']>[number])
  }

  const candidate: RuntimeModelPricing = {
    input: base.input!,
    output: base.output!,
    ...(base.cacheRead ? { cacheRead: base.cacheRead } : {}),
    ...(base.cacheWrite ? { cacheWrite: base.cacheWrite } : {}),
    ...(rules.length ? { rules } : {}),
    ...(draft.perImage ? { perImage: draft.perImage } : {}),
    ...(draft.perMinute ? { perMinute: draft.perMinute } : {})
  }
  const schemaResult = RuntimeModelPricingSchema.safeParse(candidate)
  if (!schemaResult.success) {
    for (const issue of schemaResult.error.issues) {
      if (issue.path[0] === 'rules' && typeof issue.path[1] === 'number') {
        errors.rules[issue.path[1]][String(issue.path.slice(2).join('.') || 'rule')] = issue.message
      } else if (
        issue.path[0] === 'input' ||
        issue.path[0] === 'output' ||
        issue.path[0] === 'cacheRead' ||
        issue.path[0] === 'cacheWrite'
      ) {
        errors.base[issue.path[0]] = issue.message
      }
    }
  }
  const firstInvalidRuleIndex = errors.rules.findIndex((ruleErrors) => Object.keys(ruleErrors).length > 0)
  const valid = Object.keys(errors.base).length === 0 && firstInvalidRuleIndex === -1 && schemaResult.success
  return {
    errors,
    ...(firstInvalidRuleIndex >= 0 ? { firstInvalidRuleIndex } : {}),
    ...(valid ? { pricing: schemaResult.data } : {})
  }
}

function comparable(pricing: RuntimeModelPricing): RuntimeModelPricing {
  const canonical = normalizeModelPricing(pricing)
  return { ...canonical, ...(canonical.rules.length ? {} : { rules: undefined }) }
}

export function buildModelPricingPatch(
  original: Model['pricing'],
  draft: ModelPricingDraft,
  restoreProvider = false
): RuntimeModelPricing | null | undefined {
  if (restoreProvider) return null
  const parsed = parseModelPricingDraft(draft)
  if (!parsed.pricing) return undefined
  return original && isEqual(comparable(original), comparable(parsed.pricing)) ? undefined : parsed.pricing
}

export function findModelPricingRuleConflicts(pricing: RuntimeModelPricing): Array<[number, number]> {
  const rules = normalizeModelPricing(pricing).rules
  const conflicts: Array<[number, number]> = []
  for (let left = 0; left < rules.length; left++) {
    for (let right = left + 1; right < rules.length; right++) {
      const sharedFields = Object.keys(rules[left].pricing).some((field) => field in rules[right].pricing)
      if (sharedFields && isEqual(rules[left].when, rules[right].when)) conflicts.push([left, right])
    }
  }
  return conflicts
}

export function getModelPricingCurrencySymbol(pricing: Model['pricing']): ModelPricingCurrencySymbol {
  return CURRENCY_TO_SYMBOL[pricing?.input.currency ?? pricing?.output.currency ?? 'USD']
}

export function isModelPricingCurrencySymbol(value: string): value is ModelPricingCurrencySymbol {
  return MODEL_PRICING_CURRENCY_SYMBOLS.includes(value as ModelPricingCurrencySymbol)
}

interface ZonedDateParts {
  year: number
  month: number
  day: number
}

function zonedDateParts(date: Date, timezone: string): ZonedDateParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day) }
}

function addDays(parts: ZonedDateParts, days: number): ZonedDateParts {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days))
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }
}

function zonedMidnight(parts: ZonedDateParts, timezone: string): Date {
  let timestamp = Date.UTC(parts.year, parts.month - 1, parts.day)
  for (let attempt = 0; attempt < 3; attempt++) {
    const formatted = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(new Date(timestamp))
    const values = Object.fromEntries(formatted.map((part) => [part.type, part.value]))
    const observedAsUtc = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute)
    )
    timestamp += Date.UTC(parts.year, parts.month - 1, parts.day) - observedAsUtc
  }
  return new Date(timestamp)
}

export function createPricingTimelineAnchor(date: string, timezone: string): Date {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(zonedMidnight({ year, month, day }, timezone).getTime() + 12 * 60 * 60_000)
}

export interface PricingTimelineSegment {
  startsAt: Date
  endsAt: Date
  value: number | null
  rates: TokenPricing
  appliedRuleIndexes: number[]
}

export interface PricingTimelineDay {
  date: string
  durationMinutes: number
  clockChangeMinutes: number
  segments: PricingTimelineSegment[]
}

function rateForMetric(rates: TokenPricing, metric: PricingMetric): number | null {
  const rate = rates[metric] ?? (metric === 'cacheRead' || metric === 'cacheWrite' ? rates.input : undefined)
  return rate?.perMillionTokens ?? null
}

export function buildPricingTimeline(
  pricing: RuntimeModelPricing,
  options: { week: Date; displayTimezone: string; inputTokens: number; metric: PricingMetric }
): PricingTimelineDay[] {
  const policy = compileModelPricingPolicy(pricing)
  const selected = zonedDateParts(options.week, options.displayTimezone)
  const selectedMidnight = zonedMidnight(selected, options.displayTimezone)
  const weekdayName = new Intl.DateTimeFormat('en-US', {
    timeZone: options.displayTimezone,
    weekday: 'short'
  }).format(selectedMidnight)
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekdayName)
  const monday = addDays(selected, -((weekday + 6) % 7))

  return Array.from({ length: 7 }, (_, dayIndex) => {
    const date = addDays(monday, dayIndex)
    const nextDate = addDays(date, 1)
    const start = zonedMidnight(date, options.displayTimezone)
    const end = zonedMidnight(nextDate, options.displayTimezone)
    const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60_000)
    const segments: PricingTimelineSegment[] = []
    for (let minuteIndex = 0; minuteIndex < durationMinutes; minuteIndex++) {
      const at = new Date(start.getTime() + minuteIndex * 60_000)
      const resolution = resolveModelPricing(policy, { at, inputTokens: options.inputTokens })
      const value = rateForMetric(resolution.rates, options.metric)
      const previous = segments.at(-1)
      if (previous && previous.value === value && isEqual(previous.appliedRuleIndexes, resolution.appliedRuleIndexes)) {
        previous.endsAt = new Date(at.getTime() + 60_000)
      } else {
        segments.push({
          startsAt: at,
          endsAt: new Date(at.getTime() + 60_000),
          value,
          rates: resolution.rates,
          appliedRuleIndexes: resolution.appliedRuleIndexes
        })
      }
    }
    return {
      date: `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`,
      durationMinutes,
      clockChangeMinutes: durationMinutes - 24 * 60,
      segments
    }
  })
}
