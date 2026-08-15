const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const MONTH_MS = 30 * DAY_MS
const YEAR_MS = 365 * DAY_MS

export function createDurationFormatter(language?: string): (durationMs: number) => string {
  const millisecondFormatter = new Intl.NumberFormat(language, {
    style: 'unit',
    unit: 'millisecond',
    unitDisplay: 'narrow',
    maximumFractionDigits: 0
  })
  const secondFormatter = new Intl.NumberFormat(language, {
    style: 'unit',
    unit: 'second',
    unitDisplay: 'narrow',
    maximumFractionDigits: 1
  })
  const minuteFormatter = new Intl.NumberFormat(language, {
    style: 'unit',
    unit: 'minute',
    unitDisplay: 'narrow',
    maximumFractionDigits: 0
  })
  const durationListFormatter = new Intl.ListFormat(language, { style: 'narrow', type: 'unit' })

  return (durationMs) => {
    if (durationMs < 1000) return millisecondFormatter.format(Math.round(durationMs))

    const roundedTenths = Math.round(durationMs / 100)
    if (roundedTenths < 600) return secondFormatter.format(roundedTenths / 10)

    const minutes = Math.floor(roundedTenths / 600)
    const seconds = (roundedTenths % 600) / 10
    return durationListFormatter.format([minuteFormatter.format(minutes), secondFormatter.format(seconds)])
  }
}

export function getLocaleFirstDayOfWeek(language?: string): number {
  const locale = new Intl.Locale(language ?? Intl.DateTimeFormat().resolvedOptions().locale) as Intl.Locale & {
    getWeekInfo(): { firstDay: number }
  }
  // Intl uses 1=Monday … 7=Sunday; Date#getDay uses 0=Sunday … 6=Saturday.
  return locale.getWeekInfo().firstDay % 7
}

export const formatRelativeTime = (value: string, language: string, now = Date.now()) => {
  const diffMs = new Date(value).getTime() - now
  const formatter = new Intl.RelativeTimeFormat(language, { numeric: 'auto' })

  // Pick the unit from the *rounded* magnitude, not the raw threshold: 59m54s rounds to 60 minutes,
  // which must roll up to "1 hour ago" rather than render "60 minutes ago" (and likewise 23h59m -> a
  // day, not "24 hours ago"). Rounding the magnitude keeps both directions on the same unit —
  // `Math.round` breaks ties toward +∞, so a signed test would put -11.5 months and +11.5 months on
  // different units. Months and years use fixed averages; Intl has no calendar-aware relative unit.
  const magnitude = Math.abs(diffMs)
  const sign = diffMs < 0 ? -1 : 1
  const inUnit = (unitMs: number) => sign * Math.round(magnitude / unitMs)

  if (Math.round(magnitude / MINUTE_MS) < 60) return formatter.format(inUnit(MINUTE_MS), 'minute')
  if (Math.round(magnitude / HOUR_MS) < 24) return formatter.format(inUnit(HOUR_MS), 'hour')
  if (Math.round(magnitude / DAY_MS) < 30) return formatter.format(inUnit(DAY_MS), 'day')
  if (Math.round(magnitude / MONTH_MS) < 12) return formatter.format(inUnit(MONTH_MS), 'month')
  return formatter.format(inUnit(YEAR_MS), 'year')
}
