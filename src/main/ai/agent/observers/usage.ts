/**
 * Usage observer — accumulates per-step token usage and emits a
 * `message-metadata` chunk so consumers of `readUIMessageStream`
 * (Cherry's `PersistenceBackend`, the chat UI's stats panel) see the
 * running totals.
 *
 * Why an internal observer and not just `result.totalUsage`: AI SDK's
 * top-level `finish` part is the only path that fills `totalUsage`, and
 * some providers skip it entirely. The per-step `usage` chunks are reliable
 * AS LONG AS the upstream V3 chunk follows the spec — see
 * `gatewayUsageNormalizeFeature` for the Vercel gateway's flat-vs-nested
 * shape bug we work around.
 *
 * The chunk projects AI SDK's `LanguageModelUsage` onto Cherry's legacy
 * `MessageStats`:
 *   inputTokens                         → promptTokens
 *   outputTokens                        → completionTokens
 *   totalTokens                         → totalTokens
 *   outputTokenDetails.reasoningTokens  → thoughtsTokens
 *
 * Each `onStepFinish` writes a fresh metadata chunk; `readUIMessageStream`
 * merges by key, so the final values reflect the last step's running total.
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
