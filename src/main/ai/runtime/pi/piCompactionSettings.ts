/**
 * Pi estimates saved messages at roughly four characters per token. That can
 * undercount multilingual text and tool output on custom models, so its stock
 * 20k-token retained tail can fill a 48k context even after compaction.
 * Reserve room for the next response and keep a smaller tail on those models.
 */
export function resolvePiCompactionSettings(model: { contextWindow: number; maxTokens: number }): {
  enabled: true
  reserveTokens: number
  keepRecentTokens: number
} {
  const contextWindow = Math.max(2, Math.floor(model.contextWindow))
  const maxOutputTokens = Math.max(0, Math.min(contextWindow - 1, Math.floor(model.maxTokens)))
  const inputBudget = contextWindow - maxOutputTokens

  // Large contexts have enough room for pi's normal 20k-token retained tail.
  if (contextWindow >= 100_000) {
    return { enabled: true, reserveTokens: Math.max(16_384, maxOutputTokens), keepRecentTokens: 20_000 }
  }

  return {
    enabled: true,
    reserveTokens: Math.min(
      contextWindow - 1,
      Math.max(maxOutputTokens, Math.min(32_768, Math.floor(contextWindow / 2)))
    ),
    keepRecentTokens: Math.max(1, Math.min(20_000, Math.floor(inputBudget / 5)))
  }
}
