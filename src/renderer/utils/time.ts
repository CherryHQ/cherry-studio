const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

export const formatRelativeTime = (value: string | undefined, language: string, now = Date.now()) => {
  if (!value) return undefined

  const time = Date.parse(value)
  if (!Number.isFinite(time)) return undefined

  const diffMs = time - now
  const formatter = new Intl.RelativeTimeFormat(language, { numeric: 'auto' })

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
