/**
 * In-place degrade for Bailian / QwenCloud `thinking_budget` rejections
 * (#21906): instead of failing the turn on the provider's raw 400, retry the
 * SAME model once with a corrected parameter set.
 *
 * - Rejection names a ceiling ("not greater than N", N > 0) and the attempt
 *   carried a budget above it → retry with every `thinking_budget` leaf
 *   clamped to N (thinking preserved).
 * - Rejection names ceiling 0 — the SKU takes no budget at all (e.g.
 *   `qwen3.5-ocr`) → retry once with `thinking_budget` omitted and
 *   `enable_thinking` left intact.
 * - Any other shape (unparseable ceiling, budget already within range, no
 *   budget leaf) → no retry; the failure surfaces with the actionable hint.
 *   In particular an unparseable message never silently disables thinking.
 *
 * Single-shot by construction: the retry attempt no longer matches the
 * trigger condition (budget within ceiling, or no budget leaf at all), so a
 * second identical failure falls through to the remaining retries and
 * surfaces with the actionable hint. Registered FIRST in
 * `createRetryableWrap`, before transient retries — a parameter rejection is
 * not transient and must not burn retry attempts or trigger cross-model
 * fallback before the degrade is tried.
 *
 * Streaming caveat (shared with all ai-retry entries): only pre-chunk
 * failures can be retried. A `thinking_budget` rejection always lands before
 * the first chunk, so both `doGenerate` and `doStream` are covered.
 */
import type { SharedV3ProviderOptions } from '@ai-sdk/provider'
import { isErrorAttempt, type LanguageModel, type Retryable } from 'ai-retry'

import { loggerService } from '@logger'
import {
  clampThinkingBudget,
  hasThinkingBudget,
  isThinkingBudgetRejection,
  parseThinkingBudgetCeiling,
  stripThinkingBudget
} from '@shared/ai/thinkingBudget'

const logger = loggerService.withContext('ThinkingBudgetDegrade')

export function thinkingBudgetDegradeRetryable(): Retryable<LanguageModel> {
  return (context) => {
    if (!isErrorAttempt(context.current)) return undefined
    const { error, model, options } = context.current
    if (!isThinkingBudgetRejection(error)) return undefined

    const ceiling = parseThinkingBudgetCeiling(error)
    if (ceiling !== undefined && ceiling > 0) {
      const clamped = clampThinkingBudget(options.providerOptions, ceiling)
      if (!clamped.changed) return undefined
      logger.info('retrying with thinking_budget clamped to the provider ceiling', { ceiling })
      return { model, options: { providerOptions: clamped.providerOptions as SharedV3ProviderOptions } }
    }

    // Only a reported ceiling of 0 means "this SKU takes no budget": omit it
    // and keep `enable_thinking`. Anything unparseable is left to surface
    // with the hint rather than silently disabling thinking.
    if (ceiling !== 0 || !hasThinkingBudget(options.providerOptions)) return undefined
    const stripped = stripThinkingBudget(options.providerOptions)
    if (!stripped.changed) return undefined
    logger.info('retrying without thinking_budget after provider rejection', { ceiling })
    return { model, options: { providerOptions: stripped.providerOptions as SharedV3ProviderOptions } }
  }
}
