/**
 * Pure helpers for the trash ("Recently Deleted") settings page.
 */

export interface TrashItem {
  id: string
  name: string
  deletedAt: number | undefined
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Normalize a per-entity `deletedAt` value to ms epoch.
 * Topic/assistant/painting emit ISO strings, agent/agent-session emit plain
 * datetime strings, fileEntry emits ms epoch numbers.
 */
export function toEpochMs(v: string | number | undefined): number | undefined {
  if (v === undefined) return undefined
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  const ms = new Date(v).getTime()
  return Number.isNaN(ms) ? undefined : ms
}

/**
 * Days remaining before automatic purge.
 * Returns `null` when retention is 0 (keep forever) or `deletedAtMs` is missing;
 * otherwise `Math.ceil` of the remaining days clamped to >= 0.
 */
export function computeDaysRemaining(
  deletedAtMs: number | undefined,
  retentionDays: number,
  now: number = Date.now()
): number | null {
  if (retentionDays <= 0 || deletedAtMs === undefined) return null
  const remainingMs = deletedAtMs + retentionDays * MS_PER_DAY - now
  return Math.max(0, Math.ceil(remainingMs / MS_PER_DAY))
}

/** Format a deleted-at timestamp as `YYYY-MM-DD HH:mm`; missing/invalid → "—". */
export function formatDeletedTime(ms: number | undefined): string {
  if (ms === undefined) return '—'
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return '—'

  const pad = (value: number) => value.toString().padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`
}
