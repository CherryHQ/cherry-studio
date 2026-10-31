import type { JSONObject, LanguageModelV3Usage } from '@ai-sdk/provider'
import type { SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'

import type { MessageStats } from '@shared/data/types/message'
type BetaUsage = SDKResultMessage['usage']

export function convertClaudeCodeUsage(usage: BetaUsage): LanguageModelV3Usage {
  const inputTokens = usage.input_tokens ?? 0
  const outputTokens = usage.output_tokens ?? 0
  const cacheWrite = usage.cache_creation_input_tokens ?? 0
  const cacheRead = usage.cache_read_input_tokens ?? 0

  return {
    inputTokens: {
      total: inputTokens + cacheWrite + cacheRead,
      noCache: inputTokens,
      cacheRead,
      cacheWrite
    },
    outputTokens: { total: outputTokens, text: undefined, reasoning: undefined },
    raw: JSON.parse(JSON.stringify(usage)) as JSONObject
  }
}

/** Drop `undefined`-valued keys; return `undefined` when nothing is left. */
function compactDetails<T extends Record<string, number | undefined>>(obj: T): { [K in keyof T]?: number } | undefined {
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'number') out[key] = value
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * Project a `LanguageModelV3Usage` into the live `MessageStats` token shape
 * carried by stream metadata (AI SDK v6 names). Top-level `inputTokens`
 * follows the v6 semantic of TOTAL input (cache reads and writes included) —
 * matching the SDK's own `asLanguageModelUsage` projection; the cache
 * breakdown lives in `inputTokenDetails`, and `totalTokens` is the all-in
 * figure. Persistent usage and cost come from per-invocation records instead.
 */
export function v3UsageToStats(usage: LanguageModelV3Usage): MessageStats {
  const inputTotal = usage.inputTokens.total ?? 0
  const outputTotal = usage.outputTokens.total ?? 0
  const inputTokenDetails = compactDetails({
    noCacheTokens: usage.inputTokens.noCache,
    cacheReadTokens: usage.inputTokens.cacheRead,
    cacheWriteTokens: usage.inputTokens.cacheWrite
  })
  const outputTokenDetails = compactDetails({
    textTokens: usage.outputTokens.text,
    reasoningTokens: usage.outputTokens.reasoning
  })
  return {
    inputTokens: inputTotal,
    outputTokens: outputTotal,
    totalTokens: inputTotal + outputTotal,
    ...(inputTokenDetails ? { inputTokenDetails } : {}),
    ...(outputTokenDetails ? { outputTokenDetails } : {})
  }
}
