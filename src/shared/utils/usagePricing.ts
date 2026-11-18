import {
  type AiUsageCostBreakdown,
  type AiUsagePricingSnapshot,
  AiUsagePricingSnapshotSchema
} from '@shared/data/types/aiUsageRecord'
import type { RuntimeModelPricing } from '@shared/data/types/model'

const PER_MILLION = 1_000_000

function pricingCurrency(pricing: RuntimeModelPricing): AiUsagePricingSnapshot['currency'] | undefined {
  const tokenRates = [
    pricing.input,
    pricing.output,
    pricing.cacheRead,
    pricing.cacheWrite,
    ...(pricing.inputTokenTiers ?? []).flatMap((tier) => [tier.input, tier.output, tier.cacheRead, tier.cacheWrite])
  ].filter((rate) => rate !== undefined)
  const explicitCurrencies = tokenRates.flatMap((rate) => {
    const currency = rate.currency
    return currency !== undefined ? [currency] : []
  })
  if (explicitCurrencies.length === 0) return undefined
  if (explicitCurrencies.some((currency) => currency !== explicitCurrencies[0])) return undefined
  return explicitCurrencies[0]
}

export function createAiUsagePricingSnapshot(
  pricing: RuntimeModelPricing | null | undefined,
  capturedAt = new Date().toISOString()
): AiUsagePricingSnapshot | null {
  if (!pricing) return null
  const currency = pricingCurrency(pricing)
  if (!currency) return null

  const snapshot: Omit<AiUsagePricingSnapshot, 'capturedAt'> = { currency }
  if (pricing.input?.perMillionTokens != null) snapshot.inputPerMillionTokens = pricing.input.perMillionTokens
  if (pricing.output?.perMillionTokens != null) snapshot.outputPerMillionTokens = pricing.output.perMillionTokens
  if (pricing.cacheRead?.perMillionTokens != null)
    snapshot.cacheReadPerMillionTokens = pricing.cacheRead.perMillionTokens
  if (pricing.cacheWrite?.perMillionTokens != null)
    snapshot.cacheWritePerMillionTokens = pricing.cacheWrite.perMillionTokens
  if (pricing.inputTokenTiers?.length) {
    snapshot.inputTokenTiers = pricing.inputTokenTiers.map((tier) => {
      const rates: NonNullable<AiUsagePricingSnapshot['inputTokenTiers']>[number] = {
        minInputTokens: tier.minInputTokens
      }
      if (tier.input.perMillionTokens != null) rates.inputPerMillionTokens = tier.input.perMillionTokens
      if (tier.output.perMillionTokens != null) rates.outputPerMillionTokens = tier.output.perMillionTokens
      if (tier.cacheRead?.perMillionTokens != null) rates.cacheReadPerMillionTokens = tier.cacheRead.perMillionTokens
      if (tier.cacheWrite?.perMillionTokens != null) rates.cacheWritePerMillionTokens = tier.cacheWrite.perMillionTokens
      return rates
    })
  }
  if (pricing.perImage) snapshot.perImage = { price: pricing.perImage.price, unit: pricing.perImage.unit ?? 'image' }
  const parsed = AiUsagePricingSnapshotSchema.safeParse({ ...snapshot, capturedAt })
  return parsed.success ? parsed.data : null
}

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
  const inputTokens =
    usage.inputTokens ??
    (details?.noCacheTokens !== undefined
      ? details.noCacheTokens + (details.cacheReadTokens ?? 0) + (details.cacheWriteTokens ?? 0)
      : undefined)
  let rates: Pick<
    AiUsagePricingSnapshot,
    'inputPerMillionTokens' | 'outputPerMillionTokens' | 'cacheReadPerMillionTokens' | 'cacheWritePerMillionTokens'
  > = pricing
  if (pricing.inputTokenTiers?.length) {
    if (inputTokens === undefined) return undefined
    for (const tier of pricing.inputTokenTiers) {
      if (inputTokens < tier.minInputTokens) break
      rates = tier
    }
  }

  const cacheReadTokens = details?.cacheReadTokens
  const cacheWriteTokens = details?.cacheWriteTokens
  const hasCacheDetails = cacheReadTokens !== undefined || cacheWriteTokens !== undefined
  const nonCacheInput =
    details?.noCacheTokens ??
    (inputTokens !== undefined
      ? hasCacheDetails
        ? Math.max(0, inputTokens - (cacheReadTokens ?? 0) - (cacheWriteTokens ?? 0))
        : inputTokens
      : undefined)

  const buckets = [
    ['input', nonCacheInput, rates.inputPerMillionTokens],
    ['cacheRead', cacheReadTokens, rates.cacheReadPerMillionTokens ?? rates.inputPerMillionTokens],
    ['cacheWrite', cacheWriteTokens, rates.cacheWritePerMillionTokens ?? rates.inputPerMillionTokens],
    ['output', usage.outputTokens, rates.outputPerMillionTokens]
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
