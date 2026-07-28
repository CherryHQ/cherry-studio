/**
 * Per-step token accumulator → live `message-metadata` chunk. Reading
 * `result.totalUsage` is unreliable because some providers skip the
 * top-level `finish` part; per-step `usage` chunks survive, modulo the
 * Vercel gateway shape bug handled by `gatewayUsageNormalizeFeature`.
 *
 * Projection (AI SDK v6 `LanguageModelUsage` → Cherry `MessageStats`): names
 * line up 1:1, so the snapshot is a near-copy:
 *   inputTokens / outputTokens / totalTokens               → same
 *   inputTokenDetails{noCache,cacheRead,cacheWrite}Tokens   → same
 *   outputTokenDetails{text,reasoning}Tokens                → same
 *
 * This metadata is a stream/UI view only. Persistent usage and cost are
 * materialized from per-invocation `ai_usage_record` rows; message persistence
 * deliberately ignores these cumulative token fields.
 *
 * A FULL cumulative snapshot is emitted every step: the AI SDK deep-merges
 * `message-metadata` into the accumulating message (`updateMessageMetadata`
 * recurses into plain objects), so a nested key can never be cleared — only
 * overwritten. Emitting the whole snapshot keeps every bucket authoritative
 * each step (see the invariant on `CherryUIMessageMetadata`).
 */

import type { MessageStats } from '@shared/data/types/message'
import type { LanguageModelUsage } from 'ai'

import type { Agent } from '../Agent'

const ZERO_USAGE: LanguageModelUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
  outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined }
}

/** Sum two optional counts, staying `undefined` only when BOTH sides are absent. */
const addOpt = (x: number | undefined, y: number | undefined): number | undefined =>
  x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0)

export function mergeUsage(a: LanguageModelUsage, b: LanguageModelUsage): LanguageModelUsage {
  return {
    inputTokens: (a.inputTokens ?? 0) + (b.inputTokens ?? 0),
    outputTokens: (a.outputTokens ?? 0) + (b.outputTokens ?? 0),
    totalTokens: (a.totalTokens ?? 0) + (b.totalTokens ?? 0),
    inputTokenDetails:
      a.inputTokenDetails || b.inputTokenDetails
        ? {
            noCacheTokens: addOpt(a.inputTokenDetails?.noCacheTokens, b.inputTokenDetails?.noCacheTokens),
            cacheReadTokens: addOpt(a.inputTokenDetails?.cacheReadTokens, b.inputTokenDetails?.cacheReadTokens),
            cacheWriteTokens: addOpt(a.inputTokenDetails?.cacheWriteTokens, b.inputTokenDetails?.cacheWriteTokens)
          }
        : (undefined as unknown as LanguageModelUsage['inputTokenDetails']),
    outputTokenDetails:
      a.outputTokenDetails || b.outputTokenDetails
        ? {
            textTokens: addOpt(a.outputTokenDetails?.textTokens, b.outputTokenDetails?.textTokens),
            reasoningTokens: addOpt(a.outputTokenDetails?.reasoningTokens, b.outputTokenDetails?.reasoningTokens)
          }
        : (undefined as unknown as LanguageModelUsage['outputTokenDetails']),
    // `raw` is per-step (one upstream request) and opaque, so it cannot be
    // merged — only the latest is retained. Never derive a cumulative
    // provider-reported cost from it. Per-call cost is captured by the
    // language-model usage middleware before this cumulative UI projection.
    raw: b.raw ?? a.raw
  }
}

export { ZERO_USAGE }

/** Drop `undefined`-valued keys; return `undefined` when nothing is left. */
function compact<T extends Record<string, number | undefined>>(obj: T): { [K in keyof T]?: number } | undefined {
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'number') out[key] = value
  }
  return Object.keys(out).length > 0 ? (out as { [K in keyof T]?: number }) : undefined
}

/** Project cumulative AI SDK usage into the live `MessageStats` UI shape. */
function usageToStats(total: LanguageModelUsage): MessageStats {
  const inputTokenDetails = compact({
    noCacheTokens: total.inputTokenDetails?.noCacheTokens,
    cacheReadTokens: total.inputTokenDetails?.cacheReadTokens,
    cacheWriteTokens: total.inputTokenDetails?.cacheWriteTokens
  })
  const outputTokenDetails = compact({
    textTokens: total.outputTokenDetails?.textTokens,
    reasoningTokens: total.outputTokenDetails?.reasoningTokens
  })
  return {
    ...(total.inputTokens !== undefined ? { inputTokens: total.inputTokens } : {}),
    ...(total.outputTokens !== undefined ? { outputTokens: total.outputTokens } : {}),
    ...(total.totalTokens !== undefined ? { totalTokens: total.totalTokens } : {}),
    ...(inputTokenDetails ? { inputTokenDetails } : {}),
    ...(outputTokenDetails ? { outputTokenDetails } : {})
  }
}

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
        stats: usageToStats(total)
      }
    })
  })
}
