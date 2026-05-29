const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

export const formatRelativeTime = (value: string, language: string, now = Date.now()) => {
  const diffMs = new Date(value).getTime() - now
  const absMs = Math.abs(diffMs)
  const formatter = new Intl.RelativeTimeFormat(language, { numeric: 'auto' })

  if (absMs < HOUR_MS) {
    return formatter.format(Math.round(diffMs / MINUTE_MS), 'minute')
  }

  if (absMs < DAY_MS) {
    return formatter.format(Math.round(diffMs / HOUR_MS), 'hour')
  }

  return formatter.format(Math.round(diffMs / DAY_MS), 'day')
}
