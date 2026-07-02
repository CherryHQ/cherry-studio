import type { Metrics, Usage } from '@renderer/types/message'
import type { MessageStats } from '@shared/data/types/message'

export interface CacheTokenStats {
  noCacheTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalInputTokens: number
  hitRate: number
  savedInputTokens: number
}

function buildCacheTokenStats(
  noCacheTokens: number,
  cacheReadTokens: number,
  cacheWriteTokens: number
): CacheTokenStats | undefined {
  if (cacheReadTokens === 0 && cacheWriteTokens === 0) return undefined

  const totalInputTokens = noCacheTokens + cacheReadTokens + cacheWriteTokens

  return {
    noCacheTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalInputTokens,
    hitRate: cacheReadTokens / totalInputTokens,
    // Anthropic cache reads are discounted rather than free; this is token-volume saved from re-sending.
    savedInputTokens: cacheReadTokens
  }
}

export function getCacheTokenStats(stats: MessageStats): CacheTokenStats | undefined {
  return buildCacheTokenStats(stats.noCacheTokens ?? 0, stats.cacheReadTokens ?? 0, stats.cacheWriteTokens ?? 0)
}

/**
 * Project `MessageStats` onto the OpenAI-shaped `Usage` the renderer
 * UI reads. Required OpenAI fields (`prompt_tokens` / `completion_tokens`
 * / `total_tokens`) default to 0 for the same reason the V1 path does —
 * keeping the shape stable for downstream components that don't
 * null-check every property.
 */
export function statsToUsage(stats: MessageStats): Usage {
  return {
    prompt_tokens: stats.promptTokens ?? 0,
    completion_tokens: stats.completionTokens ?? 0,
    total_tokens: stats.totalTokens ?? 0,
    ...(stats.thoughtsTokens !== undefined && { thoughts_tokens: stats.thoughtsTokens }),
    ...(stats.noCacheTokens !== undefined && { no_cache_tokens: stats.noCacheTokens }),
    ...(stats.cacheReadTokens !== undefined && { cache_read_tokens: stats.cacheReadTokens }),
    ...(stats.cacheWriteTokens !== undefined && { cache_write_tokens: stats.cacheWriteTokens }),
    ...(stats.cost !== undefined && { cost: stats.cost })
  }
}

/**
 * Project `MessageStats` onto the renderer `Metrics` shape. Only the two
 * fields read by `MessageTokens` for the tooltip speed calculation
 * (`completion_tokens`, `time_completion_millsec`) default to 0; the
 * optional time breakdowns stay optional so an absent measurement
 * surfaces as "unknown" rather than a misleading zero.
 */
export function statsToMetrics(stats: MessageStats): Metrics {
  return {
    completion_tokens: stats.completionTokens ?? 0,
    time_completion_millsec: stats.timeCompletionMs ?? 0,
    time_first_token_millsec: stats.timeFirstTokenMs,
    time_thinking_millsec: stats.timeThinkingMs
  }
}
