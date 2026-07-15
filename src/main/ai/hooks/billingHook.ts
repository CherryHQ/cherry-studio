import { loggerService } from '@logger'
import { usageLedgerService } from '@main/data/services/UsageLedgerService'
import type { Model } from '@shared/data/types/model'
import { extractProviderCost } from '@shared/utils/cost'
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
  const id = requestMessageId ?? crypto.randomUUID()
  return {
    onStepFinish: (step) => {
      if (step.usage) total = mergeUsage(total, step.usage)
    },
    onFinish: () => {
      if (!total.inputTokens && !total.outputTokens && !total.totalTokens) return
      void usageLedgerService
        .recordRequest({
          id,
          modelId: model.id,
          stats: usageToStats(total),
          providerCostUsd: extractProviderCost(total.raw)
        })
        .catch((err) => {
          logger.warn('usage ledger record failed', { id, modelId: model.id, err })
        })
    }
  }
}
