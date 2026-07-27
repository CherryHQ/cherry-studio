import { loggerService } from '@logger'
import { usageLedgerService } from '@main/data/services/UsageLedgerService'
import type { Model } from '@shared/data/types/model'
import { computeImageCost, extractProviderCost } from '@shared/utils/cost'
import type { LanguageModelUsage } from 'ai'

import type { AgentLoopHooks } from '../runtime/aiSdk'
import { mergeUsage, usageToStats, ZERO_USAGE } from '../runtime/aiSdk'

const logger = loggerService.withContext('AiBillingHook')

/**
 * Billing funnel — the single per-request capture point for the usage ledger,
 * deliberately separate from the analytics hook (telemetry and billing are
 * different concerns with different lifecycles).
 *
 * Every aiSdk request (chat, API gateway, translate, rename, …) flows through
 * `streamText`/`generateText`, so this one hook covers them all. For chat,
 * `requestMessageId` is the assistant message id — the ledger write converges
 * with the message-persistence hook on the same row; stateless requests get a
 * per-request id.
 */
export function createBillingHook(model: Model, requestMessageId?: string): Partial<AgentLoopHooks> {
  let total: LanguageModelUsage = ZERO_USAGE
  let providerCostUsd: number | undefined
  let flushed = false
  const requestId = requestMessageId ?? crypto.randomUUID()

  /**
   * Writes whatever usage has accrued so far. Wired to every terminal hook —
   * `onFinish` fires only on a clean end, so a client abort or a throwing step
   * would otherwise drop the whole request from the ledger (requests without
   * message persistence, e.g. the API gateway, have no other capture path).
   * Latched so the ledger can never double-count a request.
   */
  const flush = () => {
    if (flushed) return
    flushed = true
    if (!total.inputTokens && !total.outputTokens && !total.totalTokens) return
    void usageLedgerService
      .recordRequest({
        requestId,
        modelId: model.id,
        stats: usageToStats(total),
        providerCostUsd,
        modality: 'language'
      })
      .catch((err) => {
        logger.warn('usage ledger record failed', { requestId, modelId: model.id, err })
      })
  }

  return {
    onStepFinish: (step) => {
      if (!step.usage) return
      total = mergeUsage(total, step.usage)
      // Each step is its own upstream generation and provider-reported cost
      // covers one request, so sum it per step — the merged `raw` keeps only
      // the last step's blob.
      const stepCostUsd = extractProviderCost(step.usage.raw)
      if (stepCostUsd !== undefined) providerCostUsd = (providerCostUsd ?? 0) + stepCostUsd
    },
    onFinish: flush,
    onAbort: flush,
    onError: () => {
      flush()
      return 'abort'
    }
  }
}

/** Record a completed image request under a caller-owned stable id. */
export async function recordImageUsage(id: string, model: Model, imageCount: number): Promise<void> {
  if (imageCount <= 0) return

  const imageCost = model.pricing ? computeImageCost(imageCount, model.pricing) : undefined
  try {
    await usageLedgerService.recordRequest({
      requestId: id,
      modelId: model.id,
      modality: 'image',
      imageCount,
      stats: imageCost
        ? {
            cost: imageCost.cost,
            costSource: 'computed',
            costCurrency: imageCost.currency,
            costBreakdown: { image: imageCost.cost }
          }
        : {}
    })
  } catch (err) {
    logger.warn('usage ledger record failed', { id, modelId: model.id, err })
  }
}
