// Free tiers the provider never reports back: the user declares the ceiling, consumption comes from
// the recorded AI usage, so the two can't drift apart the way a second counter would.

import { application } from '@application'
import { loggerService } from '@logger'
import { AI_USAGE_RECORD_AGGREGATE_MAX_LIMIT } from '@shared/data/api/schemas/aiUsageRecords'
import type { ApiKeyLimitPeriod } from '@shared/data/preference/preferenceTypes'
import type { UniqueModelId } from '@shared/data/types/model'
import type { ApiKeyEntry } from '@shared/data/types/provider'
import {
  apiKeyLimitId,
  apiKeyModelLimitId,
  collectKeyUsage,
  type KeyUsageCounts,
  periodStartOf,
  usageAgainstLimit
} from '@shared/utils/apiKeyLimit'

import { aiUsageRecordService } from './AiUsageRecordService'

const logger = loggerService.withContext('ApiKeyQuota')

export { apiKeyLimitId, apiKeyModelLimitId }

// Grouped per (key, model) even though most ceilings are key-scoped: the per-key total is the sum
// over its models, so one query answers both scopes, while an `apiKey` query cannot answer the
// model-scoped one at all.
function requestsSince(from: number): KeyUsageCounts {
  const stats = aiUsageRecordService.stats({
    groupBy: 'apiKeyModel',
    metric: 'requests',
    from,
    to: Date.now(),
    limit: AI_USAGE_RECORD_AGGREGATE_MAX_LIMIT
  })
  return collectKeyUsage(stats.buckets, stats.other)
}

/**
 * Resolve the effective limit for a key, checking model-scoped first then key-scoped.
 * Returns undefined when no limit is declared (= unlimited).
 */
export function resolveKeyLimit(
  limits: Record<string, { limit: number; period: ApiKeyLimitPeriod }>,
  providerId: string,
  keyId: string,
  modelId?: UniqueModelId
) {
  return resolveScopedKeyLimit(limits, providerId, keyId, modelId)?.limit
}

/**
 * The same resolution, plus which scope won — the usage lookup has to match it. Counting a key's
 * whole traffic against a ceiling declared for one model is what let other models spend it.
 */
export function resolveScopedKeyLimit(
  limits: Record<string, { limit: number; period: ApiKeyLimitPeriod }>,
  providerId: string,
  keyId: string,
  modelId?: UniqueModelId
): { limit: { limit: number; period: ApiKeyLimitPeriod }; scopedModelId?: UniqueModelId } | undefined {
  if (modelId) {
    const modelLimit = limits[apiKeyModelLimitId(providerId, keyId, modelId)]
    if (modelLimit) return { limit: modelLimit, scopedModelId: modelId }
  }
  const keyLimit = limits[apiKeyLimitId(providerId, keyId)]
  return keyLimit ? { limit: keyLimit } : undefined
}

/** Keys still under their declared ceiling. Keys with no declared limit always count as available. */
function keysWithinQuota<T extends Pick<ApiKeyEntry, 'id'>>(
  providerId: string,
  keys: readonly T[],
  modelId?: UniqueModelId
): T[] {
  const limits = application.get('PreferenceService').get('chat.routing.api_key_limits')
  const countsByPeriod = new Map<ApiKeyLimitPeriod, KeyUsageCounts>()

  return keys.filter((key) => {
    const resolved = resolveScopedKeyLimit(limits, providerId, key.id, modelId)
    if (!resolved) return true
    const { limit, scopedModelId } = resolved

    let counts = countsByPeriod.get(limit.period)
    if (!counts) {
      counts = requestsSince(periodStartOf(limit.period))
      countsByPeriod.set(limit.period, counts)
    }
    // Unknown spend keeps the key: the provider rejecting a call beats withholding one.
    const spent = usageAgainstLimit(counts, key.id, scopedModelId)
    return spent === undefined || spent < limit.limit
  })
}

/**
 * Drops credentials that already reached their declared ceiling. Returns the input untouched when
 * every key is exhausted — letting the provider reject the call beats refusing to send one.
 */
export function filterKeysWithinQuota(
  providerId: string,
  keys: readonly ApiKeyEntry[],
  modelId?: UniqueModelId
): ApiKeyEntry[] {
  try {
    const withinQuota = keysWithinQuota(providerId, keys, modelId)
    return withinQuota.length > 0 ? withinQuota : [...keys]
  } catch (error) {
    // A quota lookup must never block a request the user asked for.
    logger.warn('quota filter failed, falling back to every key', { providerId, error })
    return [...keys]
  }
}

/**
 * Whether every usable key for this provider is spent. Used to rank the provider down while it is
 * out of quota — never to exclude it, since the ceiling is the user's own estimate and the provider
 * may well still answer.
 */
export function isProviderQuotaExhausted(
  providerId: string,
  // Deliberately narrower than ApiKeyEntry: the runtime Provider carries keys without their secret.
  keys: readonly Pick<ApiKeyEntry, 'id' | 'isEnabled'>[],
  modelId?: UniqueModelId
): boolean {
  const usable = keys.filter((key) => key.isEnabled)
  if (usable.length === 0) return false

  try {
    return keysWithinQuota(providerId, usable, modelId).length === 0
  } catch (error) {
    // Unknown means available: a failed lookup must not push a working provider down the ranking.
    logger.warn('quota lookup failed, treating the provider as available', { providerId, error })
    return false
  }
}
