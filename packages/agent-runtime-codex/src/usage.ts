import * as z from 'zod'

const tokens = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const counts = z.object({
  inputTokens: tokens,
  outputTokens: tokens,
  totalTokens: tokens,
  cachedInputTokens: tokens,
  reasoningOutputTokens: tokens,
  cacheWriteInputTokens: tokens.optional()
})
export const tokenUsageUpdate = z.object({ total: counts, last: counts, modelContextWindow: tokens.nullish() })
export type TokenCounts = z.infer<typeof counts>

export function subtractTokens(total: TokenCounts, previous: TokenCounts): TokenCounts {
  return {
    inputTokens: total.inputTokens - previous.inputTokens,
    outputTokens: total.outputTokens - previous.outputTokens,
    totalTokens: total.totalTokens - previous.totalTokens,
    cachedInputTokens: total.cachedInputTokens - previous.cachedInputTokens,
    reasoningOutputTokens: total.reasoningOutputTokens - previous.reasoningOutputTokens,
    ...(total.cacheWriteInputTokens !== undefined && {
      cacheWriteInputTokens: total.cacheWriteInputTokens - (previous.cacheWriteInputTokens ?? 0)
    })
  }
}

export function turnUsage(total: TokenCounts, baseline: TokenCounts) {
  const tokens = subtractTokens(total, baseline)
  return {
    inputTokens: tokens.inputTokens,
    outputTokens: tokens.outputTokens,
    totalTokens: tokens.totalTokens,
    cacheReadTokens: tokens.cachedInputTokens,
    noCacheTokens: tokens.inputTokens - tokens.cachedInputTokens - (tokens.cacheWriteInputTokens ?? 0),
    reasoningTokens: tokens.reasoningOutputTokens,
    ...(tokens.cacheWriteInputTokens !== undefined && { cacheWriteTokens: tokens.cacheWriteInputTokens })
  }
}
