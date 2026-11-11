export interface PromptCacheUsageInput {
  inputTokens?: number | null
  noCacheTokens?: number | null
  cacheReadTokens?: number | null
  cacheWriteTokens?: number | null
}

export interface PromptCacheUsage {
  inputTokens: number
  cacheReadTokens: number
  hitRate: number
}

export function getPromptCacheUsage(input: PromptCacheUsageInput): PromptCacheUsage | null {
  const { inputTokens, noCacheTokens, cacheReadTokens, cacheWriteTokens } = input
  if (cacheReadTokens == null) return null
  const denominator =
    inputTokens ??
    (noCacheTokens != null && cacheWriteTokens != null ? noCacheTokens + cacheReadTokens + cacheWriteTokens : null)
  if (denominator == null || denominator <= 0 || cacheReadTokens > denominator) return null
  return { inputTokens: denominator, cacheReadTokens, hitRate: cacheReadTokens / denominator }
}
