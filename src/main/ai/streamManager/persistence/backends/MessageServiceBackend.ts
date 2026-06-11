/** Finalizes a pending assistant placeholder via `messageService.update`. */

import { loggerService } from '@logger'
import { messageService } from '@main/data/services/MessageService'
import { modelService } from '@main/data/services/ModelService'
import { providerService } from '@main/data/services/ProviderService'
import type { CherryMessagePart, CherryUIMessage, MessageStats, ModelSnapshot } from '@shared/data/types/message'
import { parseUniqueModelId, type RuntimeModelPricing, type UniqueModelId } from '@shared/data/types/model'
import { computeLanguageCost } from '@shared/utils/cost'

import { finalizeInterruptedParts, type PersistAssistantInput, type PersistenceBackend } from '../PersistenceBackend'

const logger = loggerService.withContext('MessageServiceBackend')

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
 * (cache-aware); a provider-reported figure (`metadata.providerCostUsd`) is
 * trusted only when the provider is flagged `apiFeatures.reportsActualCost`
 * (e.g. OpenRouter). Best-effort: lookup failures leave the token stats
 * untouched (no cost). Returns a new object; never mutates the input.
 */
export async function enrichStatsWithCost(
  stats: MessageStats | undefined,
  modelId: UniqueModelId | undefined,
  finalMessage: CherryUIMessage | undefined
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

  const providerCostUsd = finalMessage?.metadata?.providerCostUsd
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

export interface MessageServiceBackendOptions {
  assistantMessageId: string
  /** Wins over `input.stats` — only set by callers replaying pre-computed stats. */
  stats?: MessageStats
  /** Parity with the listener signature; unused by the write. */
  modelSnapshot?: ModelSnapshot
  /** Post-success hook (topic auto-rename, usage reporting, …). */
  afterPersist?: (finalMessage: CherryUIMessage) => Promise<void>
}

export class MessageServiceBackend implements PersistenceBackend {
  readonly kind = 'sqlite'
  readonly afterPersist?: (finalMessage: CherryUIMessage) => Promise<void>

  constructor(private readonly opts: MessageServiceBackendOptions) {
    this.afterPersist = opts.afterPersist
  }

  async persistAssistant(input: PersistAssistantInput): Promise<void> {
    const { finalMessage, status, stats, modelId } = input
    const parts = finalizeInterruptedParts((finalMessage?.parts ?? []) as CherryMessagePart[], status)
    const baseStats = this.opts.stats ?? stats
    const enrichedStats = await enrichStatsWithCost(baseStats, modelId, finalMessage)
    await messageService.update(this.opts.assistantMessageId, {
      data: { parts },
      status,
      stats: enrichedStats
    })
  }

  /** Best-effort: flip the placeholder to `error` so a failed persist doesn't leave a frozen `pending` row. */
  async markTerminalError(): Promise<void> {
    await messageService.update(this.opts.assistantMessageId, { status: 'error' })
  }
}
