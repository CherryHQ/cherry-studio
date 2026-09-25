/**
 * Token budgets for the compaction summarize call itself. Compaction protects
 * the window, but the summarize request is a window-bound request too: its
 * input carries whole tool outputs, so left un-budgeted it can overflow the
 * compression model's window and come back with no summary at all.
 *
 * Shared by the turn-start (durable) and in-loop lanes so the two never
 * disagree on how a compressor window splits into input vs output.
 */
import { resolveCompressionOutputTokens } from '@cherrystudio/ai-core'

import { COMPACTION_INPUT_SAFETY_RATIO, COMPACTION_MIN_INPUT_BUDGET } from '../constants'

export function resolveSummarizeBudget(compressionWindow: number): {
  maxOutputTokens: number
  maxInputTokens: number
} {
  const maxOutputTokens = resolveCompressionOutputTokens(compressionWindow)
  const maxInputTokens = Math.min(
    Math.max(0, compressionWindow - maxOutputTokens),
    Math.max(
      COMPACTION_MIN_INPUT_BUDGET,
      Math.floor((compressionWindow - maxOutputTokens) * COMPACTION_INPUT_SAFETY_RATIO)
    )
  )
  return { maxOutputTokens, maxInputTokens }
}
