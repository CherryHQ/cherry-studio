import { COMPACTION_MIN_INPUT_BUDGET } from '@main/ai/constants'
import { describe, expect, it } from 'vitest'

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

  // Below the minimum the budget collapses to whatever room the output
  // reservation leaves instead of forcing the floor past the window.
  it('collapses to the remaining room when it falls below the minimum input budget', () => {
    const { maxInputTokens, maxOutputTokens } = resolveSummarizeBudget(5_000)

    expect(maxOutputTokens).toBeGreaterThan(0)
    expect(maxInputTokens).toBe(5_000 - maxOutputTokens)
    expect(maxInputTokens).toBeLessThan(COMPACTION_MIN_INPUT_BUDGET)
    expect(maxInputTokens + maxOutputTokens).toBeLessThanOrEqual(5_000)
  })
})
