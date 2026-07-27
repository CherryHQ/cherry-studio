import { loggerService } from '@logger'
import { aiUsageRecordService, type SourceSnapshot } from '@main/data/services/aiUsageRecord'
import type { ProviderCredentialSnapshot } from '@main/data/services/ProviderService'
import type { Model } from '@shared/data/types/model'
import type { LanguageModelUsage } from 'ai'

import type { AgentLoopHooks } from '../runtime/aiSdk'
import { mergeUsage, usageToStats, ZERO_USAGE } from '../runtime/aiSdk'
import { computeImageCost, extractProviderCost } from '../utils/billingCost'

const logger = loggerService.withContext('AiBillingHook')

export const BILLABLE_AI_OPERATIONS = ['streamText', 'generateText', 'embedMany', 'generateImage', 'rerank'] as const
export type BillableAiOperation = (typeof BILLABLE_AI_OPERATIONS)[number]

type AiUsageRecordOperationCoverage =
  | {
      status: 'recorded'
      modality: 'language' | 'embedding' | 'image'
      capture: 'agent-hook' | 'direct'
    }
  | {
      status: 'usage-unavailable'
      reason: 'ai-sdk-rerank-result-has-no-usage-or-cost'
    }

export const AI_USAGE_RECORD_OPERATION_COVERAGE = {
  streamText: { status: 'recorded', modality: 'language', capture: 'agent-hook' },
  generateText: { status: 'recorded', modality: 'language', capture: 'agent-hook' },
  embedMany: { status: 'recorded', modality: 'embedding', capture: 'direct' },
  generateImage: { status: 'recorded', modality: 'image', capture: 'direct' },
  rerank: { status: 'usage-unavailable', reason: 'ai-sdk-rerank-result-has-no-usage-or-cost' }
} as const satisfies Record<BillableAiOperation, AiUsageRecordOperationCoverage>

export interface BillingRecorder {
  hook: Partial<AgentLoopHooks>
  /** Add usage from a nested provider call, such as tool-input repair. */
  recordUsage: (usage: LanguageModelUsage) => void
}

/**
 * One request-scoped collector shared by Agent steps and nested repair calls.
 * The collector flushes once at any terminal hook and preserves explicit-zero
 * usage as an observed request.
 */
export function createBillingRecorder(
  model: Model,
  requestMessageId?: string,
  credentialSnapshot?: ProviderCredentialSnapshot,
  source?: SourceSnapshot
): BillingRecorder {
  let total: LanguageModelUsage = ZERO_USAGE
  let providerCostUsd: number | undefined
  let sawUsage = false
  let flushed = false
  const requestId = requestMessageId ?? crypto.randomUUID()

  const recordUsage = (usage: LanguageModelUsage) => {
    sawUsage = true
    total = mergeUsage(total, usage)
    const cost = extractProviderCost(usage.raw)
    if (cost !== undefined) providerCostUsd = (providerCostUsd ?? 0) + cost
  }

  const flush = () => {
    if (flushed) return
    flushed = true
    if (!sawUsage && providerCostUsd === undefined) return

    void aiUsageRecordService
      .recordRequest({
        requestId,
        modelId: model.id,
        credentialSnapshot,
        source,
        stats: usageToStats(total),
        providerCostUsd,
        modality: 'language'
      })
      .catch((err) => {
        logger.warn('AI usage record failed', { requestId, modelId: model.id, err })
      })
  }

  return {
    recordUsage,
    hook: {
      onStepFinish: (step) => {
        if (step.usage) recordUsage(step.usage)
      },
      onFinish: flush,
      onAbort: flush,
      onError: () => {
        flush()
        return 'abort'
      }
    }
  }
}

/** Compatibility helper for callers that do not own nested provider calls. */
export function createBillingHook(
  model: Model,
  requestMessageId?: string,
  credentialSnapshot?: ProviderCredentialSnapshot,
  source?: SourceSnapshot
): Partial<AgentLoopHooks> {
  return createBillingRecorder(model, requestMessageId, credentialSnapshot, source).hook
}

export async function recordImageUsage(
  id: string,
  model: Model,
  imageCount: number,
  credentialSnapshot?: ProviderCredentialSnapshot,
  source?: SourceSnapshot
): Promise<void> {
  if (imageCount <= 0) return

  const imageCost = model.pricing ? computeImageCost(imageCount, model.pricing) : undefined
  try {
    await aiUsageRecordService.recordRequest({
      requestId: id,
      modelId: model.id,
      credentialSnapshot,
      source,
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
    logger.warn('AI usage record failed', { id, modelId: model.id, err })
  }
}
