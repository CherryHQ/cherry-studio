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

/** Headroom over the estimated input: estimator error plus the summarize instructions. */
const ESTIMATED_INPUT_HEADROOM_RATIO = 1.15
const ESTIMATED_INPUT_OVERHEAD_TOKENS = 0

/**
 * @param estimatedInputTokens Estimated size of the assembled summarize input. When it is small,
 * the output may use the room the fixed minimum input reservation would otherwise withhold, so a
 * short fold on a small compressor window is not cut off by an output cap it did not need.
 * Never lowers the budget below what the window alone allows.
 */
export function resolveSummarizeBudget(
  compressionWindow: number,
  estimatedInputTokens?: number
): {
  maxOutputTokens: number
  maxInputTokens: number
} {
  // Reserve the minimum viable input before sizing output: on small compressor
  // windows the output floor would otherwise starve the input below the
  // mandatory instructions, and the summarize call throws before reaching the
  // model (the caller then runs unprotected, compaction disabled).
  const windowOutputTokens = resolveCompressionOutputTokens(compressionWindow)
  const reservedOutputTokens = Math.min(
    windowOutputTokens,
    Math.max(1, compressionWindow - COMPACTION_MIN_INPUT_BUDGET)
  )
  const maxOutputTokens =
    estimatedInputTokens !== undefined && Number.isFinite(estimatedInputTokens) && estimatedInputTokens >= 0
      ? Math.max(
          reservedOutputTokens,
          Math.min(
            windowOutputTokens,
            compressionWindow -
              Math.ceil(estimatedInputTokens * ESTIMATED_INPUT_HEADROOM_RATIO) -
              ESTIMATED_INPUT_OVERHEAD_TOKENS
          )
        )
      : reservedOutputTokens
  const availableInput = Math.max(0, compressionWindow - maxOutputTokens)
  const maxInputTokens = Math.min(
    availableInput,
    Math.max(
      COMPACTION_MIN_INPUT_BUDGET,
      Math.floor(availableInput * COMPACTION_INPUT_SAFETY_RATIO),
      // Small compressors cannot afford another input-only safety reduction:
      // the total window already carries the 10% margin. Whole tool calls and
      // carried summaries may need all input room left beside the output.
      compressionWindow < 20_000 ? availableInput : 0
    )
  )
  return { maxOutputTokens, maxInputTokens }
}
