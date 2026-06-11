/**
 * Cost enrichment for token-usage stats.
 *
 * Lives in the data layer because it is pure data-service composition
 * (model pricing + provider capability lookups + the shared cost math) and
 * has two consumers on opposite sides of the architecture: the stream
 * persistence backend (`MessageServiceBackend`) enriching `message.stats`,
 * and `UsageLedgerService.recordRequest` enriching ledger rows for requests
 * that never produce a persisted message.
 */

import { loggerService } from '@logger'
import type { MessageStats } from '@shared/data/types/message'
import { parseUniqueModelId, type RuntimeModelPricing, type UniqueModelId } from '@shared/data/types/model'
import { computeLanguageCost } from '@shared/utils/cost'

import { modelService } from '../ModelService'
import { providerService } from '../ProviderService'

const logger = loggerService.withContext('DataApi:CostEnrichment')

function buildPricingSnapshot(pricing: RuntimeModelPricing): NonNullable<MessageStats['pricingSnapshot']> {
  return {
    ...(pricing.input?.perMillionTokens != null ? { input: pricing.input.perMillionTokens } : {}),
    ...(pricing.output?.perMillionTokens != null ? { output: pricing.output.perMillionTokens } : {}),
    ...(pricing.cacheRead?.perMillionTokens != null ? { cacheRead: pricing.cacheRead.perMillionTokens } : {}),
    ...(pricing.cacheWrite?.perMillionTokens != null ? { cacheWrite: pricing.cacheWrite.perMillionTokens } : {}),
    capturedAt: new Date().toISOString()
  }
}

/**
 * Attach cost to a token-stats object. Default is computed-from-pricing
 * (cache-aware); a provider-reported figure (`providerCostUsd`, extracted
 * from the raw usage blob) is trusted only when the provider is flagged
 * `apiFeatures.reportsActualCost` (e.g. OpenRouter). Best-effort: lookup
 * failures leave the token stats untouched (no cost). Returns a new object;
 * never mutates the input.
 */
export async function enrichStatsWithCost(
  stats: MessageStats | undefined,
  modelId: UniqueModelId | undefined,
  providerCostUsd: number | undefined
): Promise<MessageStats | undefined> {
  if (!stats || !modelId) return stats

  let providerId: string
  let bareModelId: string
  try {
    ;({ providerId, modelId: bareModelId } = parseUniqueModelId(modelId))
  } catch {
    return stats
  }

  // Independent lookups — run concurrently to keep the persist path snappy.
  const [pricing, reportsActualCost] = await Promise.all([
    modelService
      .getByKey(providerId, bareModelId)
      .then((model) => model.pricing ?? undefined)
      .catch((err) => {
        logger.debug('cost enrichment: model pricing lookup failed', { modelId, err })
        return undefined
      }),
    providerService
      .getByProviderId(providerId)
      .then((provider) => provider.apiFeatures.reportsActualCost === true)
      .catch((err) => {
        logger.debug('cost enrichment: provider lookup failed', { providerId, err })
        return false
      })
  ])

  const computed = pricing ? computeLanguageCost(stats, pricing) : undefined
  const trustProvider = reportsActualCost && typeof providerCostUsd === 'number'

  if (!trustProvider && !computed) return stats

  const enriched: MessageStats = { ...stats }
  if (trustProvider) {
    enriched.cost = providerCostUsd
    enriched.costSource = 'provider'
    enriched.costCurrency = 'USD'
    // Cross-check breakdown + rate snapshot, but only when same currency to
    // avoid mixing a USD provider total with non-USD computed figures.
    if (computed && computed.currency === 'USD' && pricing) {
      enriched.costBreakdown = computed.breakdown
      enriched.pricingSnapshot = buildPricingSnapshot(pricing)
    }
  } else if (computed && pricing) {
    enriched.cost = computed.cost
    enriched.costSource = 'computed'
    enriched.costCurrency = computed.currency
    enriched.costBreakdown = computed.breakdown
    enriched.pricingSnapshot = buildPricingSnapshot(pricing)
  }
  return enriched
}
