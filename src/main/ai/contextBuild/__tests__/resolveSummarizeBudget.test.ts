import { describe, expect, it } from 'vitest'

import { COMPACTION_MIN_INPUT_BUDGET } from '@main/ai/constants'

import { resolveSummarizeBudget } from '../resolveSummarizeBudget'

describe('resolveSummarizeBudget', () => {
  // Room is ample, so the minimum floor holds and the safety ratio bites:
  // input stays below the raw room instead of filling it.
  it('floors the input budget and holds back a safety margin when room allows', () => {
    const { maxInputTokens, maxOutputTokens } = resolveSummarizeBudget(90_000)

    expect(maxOutputTokens).toBeGreaterThan(0)
    expect(maxInputTokens).toBeGreaterThanOrEqual(COMPACTION_MIN_INPUT_BUDGET)
    expect(maxInputTokens).toBeLessThan(90_000 - maxOutputTokens)
    expect(maxInputTokens + maxOutputTokens).toBeLessThanOrEqual(90_000)
  })

  // On small windows the output floor (4096) would leave less input than the
  // mandatory instructions need; rebalance output down so the input floor holds
  // and the summarize call reaches the model.
  it('rebalances the output reservation so small windows keep the minimum input budget', () => {
    const { maxInputTokens, maxOutputTokens } = resolveSummarizeBudget(5_000)

    expect(maxInputTokens).toBe(COMPACTION_MIN_INPUT_BUDGET)
    expect(maxOutputTokens).toBe(5_000 - COMPACTION_MIN_INPUT_BUDGET)
    expect(maxInputTokens + maxOutputTokens).toBeLessThanOrEqual(5_000)
  })

  // The bot-flagged case: a 5,000-token configured compressor margined to 4,500
  // previously reserved 4,096 for output and threw on a 404-token input.
  it('keeps the input floor on the margined 4,500-token compressor window', () => {
    const { maxInputTokens, maxOutputTokens } = resolveSummarizeBudget(4_500)

    expect(maxInputTokens).toBe(COMPACTION_MIN_INPUT_BUDGET)
    expect(maxOutputTokens).toBe(2_500)
    expect(maxInputTokens + maxOutputTokens).toBeLessThanOrEqual(4_500)
  })
})
