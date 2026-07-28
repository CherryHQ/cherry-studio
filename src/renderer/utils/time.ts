const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

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
