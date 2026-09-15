import { COMPACTION_MIN_INPUT_BUDGET } from '@main/ai/constants'
import { describe, expect, it } from 'vitest'

import { resolveSummarizeBudget } from '../resolveSummarizeBudget'

describe('resolveSummarizeBudget', () => {
  // A 90K compressor window splits into a ratio-sized input budget beside a
  // capped output reservation.
  it('sizes input and output from the compressor window', () => {
    const { maxInputTokens, maxOutputTokens } = resolveSummarizeBudget(90_000)

    expect(maxOutputTokens).toBe(16_384)
    expect(maxInputTokens).toBe(62_573)
    expect(maxInputTokens + maxOutputTokens).toBeLessThanOrEqual(90_000)
  })

  // Below the minimum input budget the budget collapses to whatever room the
  // output reservation leaves (5K window, 4096 output, 904 room).
  it('collapses to the remaining room when it falls below the minimum input budget', () => {
    const { maxInputTokens, maxOutputTokens } = resolveSummarizeBudget(5_000)

    expect(maxOutputTokens).toBe(4_096)
    expect(maxInputTokens).toBeLessThan(COMPACTION_MIN_INPUT_BUDGET)
    expect(maxInputTokens + maxOutputTokens).toBeLessThanOrEqual(5_000)
  })
})
