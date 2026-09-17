// Free tiers the provider never reports back: the user declares the ceiling, consumption comes from
// the recorded AI usage, so the two can't drift apart the way a second counter would.

import { application } from '@application'
import { loggerService } from '@logger'
import type { ApiKeyEntry } from '@shared/data/types/provider'
import { apiKeyLimitId } from '@shared/utils/apiKeyLimit'

import { aiUsageRecordService } from './AiUsageRecordService'

const logger = loggerService.withContext('ApiKeyQuota')

const DAY_MS = 24 * 60 * 60 * 1000
const PERIOD_MS = { daily: DAY_MS, monthly: 30 * DAY_MS } as const

export { apiKeyLimitId }

function requestsSince(from: number): Map<string, number> {
  const stats = aiUsageRecordService.stats({
    groupBy: 'apiKey',
    metric: 'requests',
    from,
    to: Date.now(),
    limit: 100
  })
  const counts = new Map<string, number>()
  for (const bucket of stats.buckets) {
    if (bucket.groupBy === 'apiKey' && bucket.apiKeyId) counts.set(bucket.apiKeyId, bucket.requestCount)
  }
  return counts
}

/**
 * Drops credentials that already reached their declared ceiling. Returns the input untouched when
 * every key is exhausted — letting the provider reject the call beats refusing to send one.
 */
export function filterKeysWithinQuota(providerId: string, keys: readonly ApiKeyEntry[]): ApiKeyEntry[] {
  const limits = application.get('PreferenceService').get('chat.routing.api_key_limits')
  const relevant = keys.filter((key) => limits[apiKeyLimitId(providerId, key.id)])
  if (relevant.length === 0) return [...keys]

  try {
    const countsByPeriod = new Map<keyof typeof PERIOD_MS, Map<string, number>>()
    const withinQuota = keys.filter((key) => {
      const limit = limits[apiKeyLimitId(providerId, key.id)]
      if (!limit) return true

      let counts = countsByPeriod.get(limit.period)
      if (!counts) {
        counts = requestsSince(Date.now() - PERIOD_MS[limit.period])
        countsByPeriod.set(limit.period, counts)
      }
      return (counts.get(key.id) ?? 0) < limit.limit
    })

    return withinQuota.length > 0 ? withinQuota : [...keys]
  } catch (error) {
    // A quota lookup must never block a request the user asked for.
    logger.warn('quota filter failed, falling back to every key', { providerId, error })
    return [...keys]
  }
}
