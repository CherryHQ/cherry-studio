const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

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

  // Pick the unit by the *rounded* value, not the raw threshold: 59m54s rounds
  // to 60 minutes, which must roll up to "1 hour ago" rather than render
  // "60 minutes ago" (and likewise 23h59m -> a day, not "24 hours ago").
  const minutes = Math.round(diffMs / MINUTE_MS)
  if (Math.abs(minutes) < 60) {
    return formatter.format(minutes, 'minute')
  }

  const hours = Math.round(diffMs / HOUR_MS)
  if (Math.abs(hours) < 24) {
    return formatter.format(hours, 'hour')
  }

  return formatter.format(Math.round(diffMs / DAY_MS), 'day')
}
