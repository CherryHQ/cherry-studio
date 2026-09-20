// Shared so the settings form and the credential picker agree on one key shape.

import { AI_USAGE_RECORD_MAX_RANGE_DAYS } from '@shared/data/api/schemas/aiUsageRecords'
import type { ApiKeyLimitPeriod } from '@shared/data/preference/preferenceTypes'
import type { UniqueModelId } from '@shared/data/types/model'
import type { ApiKeyTier } from '@shared/data/types/provider'

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
/**
 * The `from` for a usage-stats query covering these period starts.
 *
 * `periodStartOf('total')` is epoch 0 — a lifetime ceiling has no start — and the stats endpoint
 * rejects any range wider than {@link AI_USAGE_RECORD_MAX_RANGE_DAYS}. Passing that 0 through does
 * not just break the total-period row: the whole request fails, so every used/remaining/forecast
 * column that shares the query goes blank with nothing on screen to say why.
 */
export function usageStatsFrom(periodStarts: readonly number[], now: number = Date.now()): number {
  const earliest = periodStarts.length > 0 ? Math.min(...periodStarts) : now
  const floor = now - (AI_USAGE_RECORD_MAX_RANGE_DAYS - 1) * 24 * 60 * 60 * 1000
  return Math.max(earliest, floor)
}

/** Joins a stats bucket's key and model the way {@link collectKeyUsage} indexes them. */
export const keyModelUsageId = (keyId: string, modelId: string) => `${keyId}::${modelId}`

/**
 * Requests spent, in the two shapes quota math needs: a model-scoped ceiling is spent by one
 * `(key, model)` pair, a key-scoped one by every model on that key. Reading the key-wide total
 * against a model-scoped ceiling is what made "50/day for one model" die to traffic on another.
 */
export interface KeyUsageCounts {
  /** Requests on one `(key, model)` pair, indexed by {@link keyModelUsageId}. */
  readonly perKeyModel: ReadonlyMap<string, number>
  /** Requests on a key across every model. */
  readonly perKey: ReadonlyMap<string, number>
  /**
   * The response dropped buckets past its limit, so an entry missing from these maps spent an
   * *unknown* amount, not zero. Callers must read absence as unknown while this is set — counting
   * it as zero would hand out room that may not exist.
   */
  readonly truncated: boolean
}

type UsageBucket = {
  groupBy: string
  apiKeyId?: string | null
  modelId?: string | null
  requestCount: number
}

/**
 * Fold an `apiKeyModel`-grouped stats response into per-pair and per-key totals. Buckets of any
 * other grouping are ignored, so a caller that asked for `apiKey` gets empty maps rather than
 * counts silently attributed to the wrong dimension.
 */
export function collectKeyUsage(
  buckets: readonly UsageBucket[] | undefined,
  other?: { requestCount: number } | null
): KeyUsageCounts {
  const perKeyModel = new Map<string, number>()
  const perKey = new Map<string, number>()

  for (const bucket of buckets ?? []) {
    if (bucket.groupBy !== 'apiKeyModel' || !bucket.apiKeyId) continue
    if (bucket.modelId) {
      perKeyModel.set(keyModelUsageId(bucket.apiKeyId, bucket.modelId), bucket.requestCount)
    }
    perKey.set(bucket.apiKeyId, (perKey.get(bucket.apiKeyId) ?? 0) + bucket.requestCount)
  }

  return { perKeyModel, perKey, truncated: (other?.requestCount ?? 0) > 0 }
}

/**
 * Requests spent against one ceiling, or `undefined` when the answer is genuinely unknown because
 * the response was truncated. `undefined` must stay permissive everywhere it lands — routing is an
 * optimization, never a gate.
 */
export function usageAgainstLimit(
  counts: KeyUsageCounts,
  keyId: string,
  modelId: UniqueModelId | undefined
): number | undefined {
  const spent = modelId ? counts.perKeyModel.get(keyModelUsageId(keyId, modelId)) : counts.perKey.get(keyId)
  if (spent !== undefined) return spent
  return counts.truncated ? undefined : 0
}

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

/** Per-limit bookkeeping for {@link dueQuotaNotices}, persisted so a reminder never repeats. */
export type QuotaNoticeState = Record<string, { lastPeriodStart?: number; trialEndingNotifiedAt?: number }>

/** One declared limit's current shape — enough to decide whether a notice about it is due. */
export interface QuotaNoticeInput {
  /** Same id as its entry in `chat.routing.api_key_limits` (`apiKeyLimitId` or `apiKeyModelLimitId`). */
  limitKey: string
  period: ApiKeyLimitPeriod
  limit: number
  tier: ApiKeyTier
  renewalAnchor?: string
  renewalTimezone?: string
  /** Requests recorded so far in the current period; only consulted for a `trial` + `'total'` key. */
  used: number
}

/** A quota event worth telling the user about once. */
export type QuotaNotice = { kind: 'new_period'; limitKey: string } | { kind: 'trial_exhausted'; limitKey: string }

/**
 * Diffs each declared limit's current period (and, for a one-shot trial, its usage) against what
 * was last recorded, and returns the notices that became true since then plus the state to
 * persist for next time.
 *
 * - A limit seen for the first time only records a baseline, never a notice — otherwise every
 *   key would "start a new period" the moment this feature ships.
 * - `'new_period'` fires once per calendar rollover (`periodStartOf` advancing), for any tier. It
 *   reports what the app's own usage tracking did, not a provider-verified reset.
 * - `'trial_exhausted'` fires once, ever, for a `trial` + `'total'` key once usage reaches the
 *   declared limit — that pool never refills, so there is nothing to repeat the warning about.
 */
export function dueQuotaNotices(
  keys: readonly QuotaNoticeInput[],
  state: QuotaNoticeState,
  nowMs: number = Date.now()
): { notices: QuotaNotice[]; nextState: QuotaNoticeState } {
  const notices: QuotaNotice[] = []
  const nextState: QuotaNoticeState = { ...state }

  for (const key of keys) {
    const prev = state[key.limitKey]

    if (key.period !== 'total') {
      const periodStart = periodStartOf(key.period, key.renewalAnchor, key.renewalTimezone)
      if (prev?.lastPeriodStart !== undefined && periodStart > prev.lastPeriodStart) {
        notices.push({ kind: 'new_period', limitKey: key.limitKey })
      }
      if (prev?.lastPeriodStart !== periodStart) {
        nextState[key.limitKey] = { ...prev, lastPeriodStart: periodStart }
      }
      continue
    }

    if (key.tier !== 'trial' || prev?.trialEndingNotifiedAt !== undefined) continue

    const forecast = forecastQuotaExhaustion({
      used: key.used,
      limit: key.limit,
      periodStartMs: periodStartOf('total'),
      renewsAtMs: periodRenewsAt('total'),
      nowMs
    })
    if (forecast.kind === 'exhausted') {
      notices.push({ kind: 'trial_exhausted', limitKey: key.limitKey })
      nextState[key.limitKey] = { ...prev, trialEndingNotifiedAt: nowMs }
    }
  }

  return { notices, nextState }
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
