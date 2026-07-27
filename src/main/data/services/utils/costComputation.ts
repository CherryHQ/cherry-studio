import { CURRENCY, type Currency, type RuntimeModelPricing } from '@shared/data/types/model'

const PER_MILLION = 1_000_000

export interface LanguageCostUsage {
  inputTokens?: number
  outputTokens?: number
  inputTokenDetails?: {
    noCacheTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
  }
}

export interface LanguageCostBreakdown {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
}

export interface LanguageCostResult {
  cost: number
  breakdown: LanguageCostBreakdown
  currency: Currency
}

/**
 * Compute cache-aware language cost from the all-in input count and any
 * provider breakdown. Partial cache details are subtracted from the total so
 * no token can be priced as both regular input and cached input.
 */
export function computeLanguageCost(
  usage: LanguageCostUsage,
  pricing: RuntimeModelPricing
): LanguageCostResult | undefined {
  const inputRate = pricing.input?.perMillionTokens ?? null
  const outputRate = pricing.output?.perMillionTokens ?? null
  const cacheReadRate = pricing.cacheRead?.perMillionTokens ?? inputRate
  const cacheWriteRate = pricing.cacheWrite?.perMillionTokens ?? inputRate
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

  const breakdown: LanguageCostBreakdown = {}
  let cost = 0
  let priced = false

  const add = (key: keyof LanguageCostBreakdown, tokens: number | undefined, rate: number | null): void => {
    if (tokens == null || rate == null || !Number.isFinite(tokens) || !Number.isFinite(rate)) return
    const value = (tokens * rate) / PER_MILLION
    breakdown[key] = value
    cost += value
    priced = true
  }

  add('input', nonCacheInput, inputRate)
  add('cacheRead', cacheReadTokens, cacheReadRate)
  add('cacheWrite', cacheWriteTokens, cacheWriteRate)
  add('output', usage.outputTokens, outputRate)

  return priced ? { cost, breakdown, currency: pricing.input?.currency ?? CURRENCY.USD } : undefined
}
