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
  // Reserve the minimum viable input before sizing output: on small compressor
  // windows the output floor would otherwise starve the input below the
  // mandatory instructions, and the summarize call throws before reaching the
  // model (the caller then runs unprotected, compaction disabled).
  const maxOutputTokens = Math.min(
    resolveCompressionOutputTokens(compressionWindow),
    Math.max(1, compressionWindow - COMPACTION_MIN_INPUT_BUDGET)
  )
  const availableInput = Math.max(0, compressionWindow - maxOutputTokens)
  const maxInputTokens = Math.min(
    availableInput,
    Math.max(COMPACTION_MIN_INPUT_BUDGET, Math.floor(availableInput * COMPACTION_INPUT_SAFETY_RATIO))
  )
  return { maxOutputTokens, maxInputTokens }
}
