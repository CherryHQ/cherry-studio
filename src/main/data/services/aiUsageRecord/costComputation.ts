import type { AiUsageCostBreakdown, AiUsagePricingSnapshot } from '@shared/data/types/aiUsageRecord'

const PER_MILLION = 1_000_000

interface LanguageCostUsage {
  inputTokens?: number
  outputTokens?: number
  inputTokenDetails?: {
    noCacheTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
  }
}

interface LanguageCostResult {
  cost: number
  breakdown: AiUsageCostBreakdown
}

/**
 * Compute the usage-record domain's cache-aware language cost from the all-in
 * input count and any provider breakdown. Partial cache details are subtracted
 * from the total so no token can be priced as both regular input and cached
 * input. A cost is returned only when every non-zero usage bucket has a known
 * rate.
 */
export function computeLanguageCost(
  usage: LanguageCostUsage,
  pricing: AiUsagePricingSnapshot
): LanguageCostResult | undefined {
  const details = usage.inputTokenDetails
  const cacheReadTokens = details?.cacheReadTokens
  const cacheWriteTokens = details?.cacheWriteTokens
  const hasCacheDetails = cacheReadTokens !== undefined || cacheWriteTokens !== undefined
  const nonCacheInput =
    details?.noCacheTokens ??
    (usage.inputTokens !== undefined
      ? hasCacheDetails
        ? Math.max(0, usage.inputTokens - (cacheReadTokens ?? 0) - (cacheWriteTokens ?? 0))
        : usage.inputTokens
      : undefined)

  const buckets = [
    ['input', nonCacheInput, pricing.inputPerMillionTokens],
    ['cacheRead', cacheReadTokens, pricing.cacheReadPerMillionTokens ?? pricing.inputPerMillionTokens],
    ['cacheWrite', cacheWriteTokens, pricing.cacheWritePerMillionTokens ?? pricing.inputPerMillionTokens],
    ['output', usage.outputTokens, pricing.outputPerMillionTokens]
  ] as const

  if (!buckets.some(([, tokens]) => tokens !== undefined)) return undefined
  if (buckets.some(([, tokens, rate]) => tokens !== undefined && tokens > 0 && rate === undefined)) return undefined

  const breakdown: AiUsageCostBreakdown = {}
  let cost = 0
  for (const [key, tokens, rate] of buckets) {
    if (tokens === undefined || rate === undefined) continue
    const value = (tokens * rate) / PER_MILLION
    breakdown[key] = value
    cost += value
  }

  return Number.isFinite(cost) && cost >= 0 ? { cost, breakdown } : undefined
}
