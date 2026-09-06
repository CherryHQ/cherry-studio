/**
 * Pure helpers for the trash ("Recently Deleted") settings page.
 */

import { formatErrorMessage } from '@renderer/utils/error'
import dayjs from 'dayjs'

export interface TrashItem {
  id: string
  name: string
  deletedAt: number | undefined
}

export interface TrashBatchOutcome {
  succeeded: string[]
  failed: Array<{
    id: string
    error: string
    reason?: 'no-longer-in-recycle-bin'
  }>
}

export async function runPerItem(
  items: TrashItem[],
  mutate: (item: TrashItem) => Promise<unknown>
): Promise<TrashBatchOutcome> {
  const succeeded: string[] = []
  const failed: TrashBatchOutcome['failed'] = []

  for (const item of items) {
    try {
      await mutate(item)
      succeeded.push(item.id)
    } catch (error) {
      failed.push({ id: item.id, error: formatErrorMessage(error) })
    }
  }

  return { succeeded, failed }
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
 * Returns `null` when no countdown should be shown, `0` when expired,
 * `'less-than-day'` for a positive remainder below one day, or a positive
 * integer day count otherwise.
 */
export function computeDaysRemaining(
  deletedAtMs: number | undefined,
  retentionDays: number,
  now: number = Date.now()
): number | 'less-than-day' | null {
  if (retentionDays <= 0 || deletedAtMs === undefined) return null
  const remainingMs = deletedAtMs + retentionDays * MS_PER_DAY - now
  if (remainingMs <= 0) return 0
  if (remainingMs < MS_PER_DAY) return 'less-than-day'
  return Math.ceil(remainingMs / MS_PER_DAY)
}

/** Format a deleted-at timestamp as `YYYY-MM-DD HH:mm`; missing/invalid → "—". */
export function formatDeletedTime(ms: number | undefined): string {
  if (ms === undefined) return '—'
  const date = dayjs(ms)
  return date.isValid() ? date.format('YYYY-MM-DD HH:mm') : '—'
}
