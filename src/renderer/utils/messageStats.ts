/**
 * Stats projection: `MessageStats` (DB / shared schema, camelCase) →
 * Renderer `Usage` / `Metrics` (OpenAI snake_case) consumed by
 * `MessageTokens` and friends.
 *
 * Kept as pure functions so both the V1 block-based renderer data source
 * (`getTopicMessages` in `useTopic.ts`) and the V2 chat adapter
 * (`useChatWithHistory.adaptedMessages`) share a single projection path —
 * no inline re-implementation drift when the `MessageStats` schema
 * redesign (see TODO in `packages/shared/data/types/message.ts`) finally
 * lands.
 */

import type { Metrics, Usage } from '@renderer/types'
import type { MessageStats } from '@shared/data/types/message'

/**
 * Project `MessageStats` onto the OpenAI-shaped `Usage` the renderer
 * UI reads. Required OpenAI fields (`prompt_tokens` / `completion_tokens`
 * / `total_tokens`) default to 0 for the same reason the V1 path does —
 * keeping the shape stable for downstream components that don't
 * null-check every property.
 */
export function statsToUsage(stats: MessageStats): Usage {
  return {
    prompt_tokens: stats.inputTokens ?? 0,
    completion_tokens: stats.outputTokens ?? 0,
    total_tokens: stats.totalTokens ?? 0,
    ...(stats.outputTokenDetails?.reasoningTokens !== undefined && {
      thoughts_tokens: stats.outputTokenDetails.reasoningTokens
    }),
    ...(stats.inputTokenDetails?.cacheReadTokens !== undefined && {
      cache_read_tokens: stats.inputTokenDetails.cacheReadTokens
    }),
    ...(stats.inputTokenDetails?.cacheWriteTokens !== undefined && {
      cache_write_tokens: stats.inputTokenDetails.cacheWriteTokens
    }),
    ...(stats.cost !== undefined && { cost: stats.cost }),
    ...(stats.costSource !== undefined && { cost_source: stats.costSource }),
    ...(stats.costCurrency !== undefined && { cost_currency: stats.costCurrency }),
    ...(stats.costBreakdown !== undefined && { cost_breakdown: stats.costBreakdown })
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
    completion_tokens: stats.outputTokens ?? 0,
    time_completion_millsec: stats.timeCompletionMs ?? 0,
    time_first_token_millsec: stats.timeFirstTokenMs,
    time_thinking_millsec: stats.timeThinkingMs
  }
}
