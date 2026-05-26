/**
 * Per-step token accumulator → `message-metadata` chunk. Reading
 * `result.totalUsage` is unreliable because some providers skip the
 * top-level `finish` part; per-step `usage` chunks survive, modulo the
 * Vercel gateway shape bug handled by `gatewayUsageNormalizeFeature`.
 *
 * Projection (AI SDK `LanguageModelUsage` → Cherry `MessageStats`):
 *   inputTokens                         → promptTokens
 *   outputTokens                        → completionTokens
 *   outputTokenDetails.reasoningTokens  → thoughtsTokens
 */

import type { LanguageModelUsage } from 'ai'

import type { Agent } from '../Agent'

const ZERO_USAGE: LanguageModelUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
  outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined }
}

export function mergeUsage(a: LanguageModelUsage, b: LanguageModelUsage): LanguageModelUsage {
  return {
    inputTokens: (a.inputTokens ?? 0) + (b.inputTokens ?? 0),
    outputTokens: (a.outputTokens ?? 0) + (b.outputTokens ?? 0),
    totalTokens: (a.totalTokens ?? 0) + (b.totalTokens ?? 0),
    inputTokenDetails: b.inputTokenDetails ?? a.inputTokenDetails,
    outputTokenDetails: b.outputTokenDetails ?? a.outputTokenDetails
  }
}

export { ZERO_USAGE }

export function attachUsageObserver(agent: Agent): void {
  let total: LanguageModelUsage = ZERO_USAGE

  agent.on('onStart', () => {
    total = ZERO_USAGE
  })

  agent.on('onStepFinish', (step) => {
    if (!step.usage) return
    total = mergeUsage(total, step.usage)
    agent.write({
      type: 'message-metadata',
      messageMetadata: {
        totalTokens: total.totalTokens,
        promptTokens: total.inputTokens,
        completionTokens: total.outputTokens,
        thoughtsTokens: total.outputTokenDetails?.reasoningTokens
      }
    })
  })
}
