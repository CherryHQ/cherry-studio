import { describe, expect, it } from 'vitest'

import { resolveCompressionOutputTokens } from '@cherrystudio/ai-core'

import { COMPACTION_INPUT_SAFETY_RATIO, COMPACTION_MIN_INPUT_BUDGET } from '../../constants'
import { resolveCompressionBudget } from '../resolveCompressionBudget'

describe('resolveCompressionBudget', () => {
  it('keeps a 4k compressor usable without an impossible input/output floor pair', () => {
    expect(resolveCompressionBudget(4096)).toEqual({ maxOutputTokens: 1024, maxInputTokens: 2611 })
  })

  it.each([8000, 8192, 16384, 32768, 128000, 1000000])('preserves existing feasible budgets at %i', (window) => {
    const output = resolveCompressionOutputTokens(window)
    expect(resolveCompressionBudget(window)).toEqual({
      maxOutputTokens: output,
      maxInputTokens: Math.max(
        COMPACTION_MIN_INPUT_BUDGET,
        Math.floor((window - output) * COMPACTION_INPUT_SAFETY_RATIO)
      )
    })
  })

  it.each([0, 1, 2, -1, NaN, Infinity, 3.5])('rejects an unusable window %s', (window) => {
    expect(() => resolveCompressionBudget(window)).toThrow(/positive input and output/)
  })

  it('never lets either floor consume the other reservation or its safety margin', () => {
    for (let window = 1024; window <= 32768; window += 127) {
      const budget = resolveCompressionBudget(window)
      expect(budget.maxOutputTokens).toBeGreaterThan(0)
      expect(budget.maxInputTokens).toBeGreaterThan(0)
      expect(budget.maxInputTokens).toBeLessThanOrEqual(
        Math.floor((window - budget.maxOutputTokens) * COMPACTION_INPUT_SAFETY_RATIO)
      )
      expect(budget.maxInputTokens + budget.maxOutputTokens).toBeLessThan(window)
    }
  })
})
