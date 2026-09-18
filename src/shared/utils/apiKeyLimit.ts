// Shared so the settings form and the credential picker agree on one key shape.

import type { ApiKeyLimitPeriod } from '@shared/data/preference/preferenceTypes'
import type { UniqueModelId } from '@shared/data/types/model'

/** Identifies a credential's quota entry in `chat.routing.api_key_limits`. */
export const apiKeyLimitId = (providerId: string, keyId: string) => `${providerId}::${keyId}`

/**
 * Model-scoped limit: checked first, falls back to `apiKeyLimitId` if absent.
 *
 * `modelId` is the full {@link UniqueModelId} (`providerId::modelId`), which is what `Model.id`
 * already holds — so the composed id repeats the provider, e.g. `openai::key1::openai::gpt-4o`.
 * Every reader and writer must pass the same shape: a bare model id silently matches nothing.
 */
export const apiKeyModelLimitId = (providerId: string, keyId: string, modelId: UniqueModelId) =>
  `${providerId}::${keyId}::${modelId}`

/**
 * Calendar-aligned start of the current quota period (epoch ms).
 *
 * - `'daily'`   → midnight today
 * - `'weekly'`  → same weekday as anchor (default Monday) this week or last
 * - `'monthly'` → same day-of-month as anchor (default 1st) this month or last
 * - `'total'`   → 0 (never resets)
 *
 * All dates computed in `tz` (IANA string, default UTC).
 */
export function periodStartOf(period: ApiKeyLimitPeriod, anchor?: string, tz: string = 'UTC'): number {
  if (period === 'total') return 0

  const nowInTz = zonedDate(Date.now(), tz)

  if (period === 'daily') {
    nowInTz.setHours(0, 0, 0, 0)
    return zonedToUtcMs(nowInTz, tz)
  }

  if (period === 'weekly') {
    const anchorDay = anchor ? new Date(anchor).getUTCDay() : 1
    const diff = (nowInTz.getDay() - anchorDay + 7) % 7
    nowInTz.setDate(nowInTz.getDate() - diff)
    nowInTz.setHours(0, 0, 0, 0)
    return zonedToUtcMs(nowInTz, tz)
  }

  // monthly
  const anchorDom = anchor ? new Date(anchor).getUTCDate() : 1
  nowInTz.setHours(0, 0, 0, 0)
  if (nowInTz.getDate() < anchorDom) {
    nowInTz.setMonth(nowInTz.getMonth() - 1)
  }
  const lastDay = new Date(nowInTz.getFullYear(), nowInTz.getMonth() + 1, 0).getDate()
  nowInTz.setDate(Math.min(anchorDom, lastDay))
  return zonedToUtcMs(nowInTz, tz)
}

/**
 * Next renewal timestamp (epoch ms), or `null` for `'total'`.
 */
export function periodRenewsAt(period: ApiKeyLimitPeriod, anchor?: string, tz: string = 'UTC'): number | null {
  if (period === 'total') return null
  const start = periodStartOf(period, anchor, tz)
  const d = zonedDate(start, tz)
  if (period === 'daily') d.setDate(d.getDate() + 1)
  else if (period === 'weekly') d.setDate(d.getDate() + 7)
  else d.setMonth(d.getMonth() + 1)
  return zonedToUtcMs(d, tz)
}

/** What the current burn rate implies for a quota window. */
export type QuotaForecast =
  | { kind: 'unknown' }
  | { kind: 'within-period' }
  | { kind: 'exhausted' }
  | { kind: 'runs-out'; atMs: number }

/**
 * Projects when a key runs out, assuming it keeps being used at the rate observed so far this
 * period. `'within-period'` means the quota outlasts the period and renews before it runs dry.
 */
export function forecastQuotaExhaustion(input: {
  used: number
  limit: number
  periodStartMs: number
  renewsAtMs: number | null
  nowMs: number
}): QuotaForecast {
  const { used, limit, periodStartMs, renewsAtMs, nowMs } = input
  if (used >= limit) return { kind: 'exhausted' }

  const elapsedMs = nowMs - periodStartMs
  if (used <= 0 || elapsedMs <= 0) return { kind: 'unknown' }

  const msPerRequest = elapsedMs / used
  const atMs = nowMs + (limit - used) * msPerRequest
  if (renewsAtMs !== null && atMs >= renewsAtMs) return { kind: 'within-period' }
  return { kind: 'runs-out', atMs }
}

function zonedDate(utcMs: number, tz: string): Date {
  const utc = new Date(utcMs)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(utc)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  return new Date(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
}

function zonedToUtcMs(local: Date, tz: string): number {
  const iso = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}T${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}:${String(local.getSeconds()).padStart(2, '0')}`
  const inTz = new Date(new Date(iso + 'Z').getTime())
  const offset = inTz.getTime() - zonedDate(inTz.getTime(), tz).getTime()
  return local.getTime() + offset
}
