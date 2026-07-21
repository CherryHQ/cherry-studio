import { describe, expect, it } from 'vitest'

import { computeBudgetTokens, FALLBACK_TOKEN_LIMIT, getThinkingBudget } from '../reasoningBudget'

const KNOWN_LIMIT = { min: 128, max: 32768 }
const EFFORT_RATIO = { low: 0.2, medium: 0.5, high: 0.8 }

describe('getThinkingBudget', () => {
  it('returns undefined when effort is unset or "none"', () => {
    expect(getThinkingBudget(undefined, undefined, KNOWN_LIMIT, EFFORT_RATIO)).toBeUndefined()
    expect(getThinkingBudget(undefined, 'none', KNOWN_LIMIT, EFFORT_RATIO)).toBeUndefined()
  })

  it('computes a budget from the model token limit for a known effort key', () => {
    expect(getThinkingBudget(undefined, 'low', KNOWN_LIMIT, EFFORT_RATIO)).toBe(
      computeBudgetTokens(KNOWN_LIMIT, EFFORT_RATIO.low)
    )
  })

  it('falls back to the high ratio (never NaN) for an unknown effort key on the known-limit path', () => {
    const budget = getThinkingBudget(undefined, 'ultra', KNOWN_LIMIT, EFFORT_RATIO)
    expect(Number.isNaN(budget)).toBe(false)
    expect(budget).toBe(computeBudgetTokens(KNOWN_LIMIT, EFFORT_RATIO.high))
  })

  it('returns undefined for missing descriptor limits unless fallbackOnUnknown is set', () => {
    expect(getThinkingBudget(undefined, 'low', undefined, EFFORT_RATIO)).toBeUndefined()
  })

  it('uses FALLBACK_TOKEN_LIMIT (and the high-ratio guard) when limits are missing', () => {
    const budget = getThinkingBudget(undefined, 'ultra', undefined, EFFORT_RATIO, { fallbackOnUnknown: true })
    expect(Number.isNaN(budget)).toBe(false)
    expect(budget).toBe(computeBudgetTokens(FALLBACK_TOKEN_LIMIT, EFFORT_RATIO.high))
  })

  it('caps the budget at maxTokens', () => {
    expect(getThinkingBudget(2048, 'high', KNOWN_LIMIT, EFFORT_RATIO)).toBe(2048)
  })
})
