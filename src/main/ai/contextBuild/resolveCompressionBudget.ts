import { resolveCompressionOutputTokens } from '@cherrystudio/ai-core'

import { COMPACTION_INPUT_SAFETY_RATIO, COMPACTION_MIN_INPUT_BUDGET } from '../constants'

/**
 * Keep the existing summary output floor when its input floor still fits safely.
 * For a smaller effective window, use the same quarter-window output share as
 * aiCore, rather than reserving almost the entire window for output. The input
 * floor is only a preference: it must never exceed the remaining safe room.
 */
export function resolveCompressionBudget(contextWindow: number): { maxOutputTokens: number; maxInputTokens: number } {
  if (!Number.isSafeInteger(contextWindow) || contextWindow < 3) {
    throw new Error('Compression context window cannot hold positive input and output budgets.')
  }
  let maxOutputTokens = resolveCompressionOutputTokens(contextWindow)
  let safeInputRoom = Math.floor((contextWindow - maxOutputTokens) * COMPACTION_INPUT_SAFETY_RATIO)
  if (safeInputRoom < COMPACTION_MIN_INPUT_BUDGET) {
    maxOutputTokens = Math.max(1, Math.floor(contextWindow * 0.25))
    safeInputRoom = Math.max(0, Math.floor((contextWindow - maxOutputTokens) * COMPACTION_INPUT_SAFETY_RATIO))
  }
  return { maxOutputTokens, maxInputTokens: safeInputRoom }
}
