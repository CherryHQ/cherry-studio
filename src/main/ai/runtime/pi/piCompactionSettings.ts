import type { Model } from '@shared/data/types/model'

import { resolveAgentContextWindow } from '../agentContextWindow'

const DEFAULT_RESERVE_TOKENS = 16_384
const DEFAULT_KEEP_RECENT_TOKENS = 20_000
const DEFAULT_MAX_OUTPUT_TOKENS = 8_192

/**
 * Size Pi's compaction budgets from the selected model so small windows still
 * leave room for output and for estimator error in the retained tail.
 */
export function resolvePiCompactionSettings(model: Model): { reserveTokens: number; keepRecentTokens: number } {
  const window = resolveAgentContextWindow(model)
  const maxOutput = model.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS
  const reserveTokens = Math.min(
    Math.max(DEFAULT_RESERVE_TOKENS, maxOutput + Math.ceil(window * 0.1)),
    Math.floor(window / 2)
  )
  const keepRecentTokens = Math.min(DEFAULT_KEEP_RECENT_TOKENS, Math.floor(window / 4))
  return { reserveTokens, keepRecentTokens }
}
