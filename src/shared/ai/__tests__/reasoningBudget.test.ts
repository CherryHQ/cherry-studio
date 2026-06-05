import { describe, expect, it } from 'vitest'

import { computeBudgetTokens, FALLBACK_TOKEN_LIMIT, getThinkingBudget } from '../reasoningBudget'

// `gemini-pro-latest` is a known entry in THINKING_TOKEN_MAP ({ min: 128, max: 32768 }),
// so it drives the known-token-limit branch of getThinkingBudget.
const KNOWN_MODEL = 'gemini-pro-latest'
const KNOWN_LIMIT = { min: 128, max: 32768 }
const UNKNOWN_MODEL = 'totally-unknown-model-xyz'
const EFFORT_RATIO = { low: 0.2, medium: 0.5, high: 0.8 }

describe('getThinkingBudget', () => {
  it('returns undefined when effort is unset or "none"', () => {
    expect(getThinkingBudget(undefined, undefined, KNOWN_MODEL, EFFORT_RATIO)).toBeUndefined()
    expect(getThinkingBudget(undefined, 'none', KNOWN_MODEL, EFFORT_RATIO)).toBeUndefined()
  })

  it('computes a budget from the model token limit for a known effort key', () => {
    expect(getThinkingBudget(undefined, 'low', KNOWN_MODEL, EFFORT_RATIO)).toBe(
      computeBudgetTokens(KNOWN_LIMIT, EFFORT_RATIO.low)
    )
  })

  it('falls back to the high ratio (never NaN) for an unknown effort key on the known-limit path', () => {
    const budget = getThinkingBudget(undefined, 'ultra', KNOWN_MODEL, EFFORT_RATIO)
    expect(Number.isNaN(budget)).toBe(false)
    expect(budget).toBe(computeBudgetTokens(KNOWN_LIMIT, EFFORT_RATIO.high))
  })

  it('returns undefined for an unknown model unless fallbackOnUnknown is set', () => {
    expect(getThinkingBudget(undefined, 'low', UNKNOWN_MODEL, EFFORT_RATIO)).toBeUndefined()
  })

  it('uses FALLBACK_TOKEN_LIMIT (and the high-ratio guard) for an unknown model + unknown effort', () => {
    const budget = getThinkingBudget(undefined, 'ultra', UNKNOWN_MODEL, EFFORT_RATIO, { fallbackOnUnknown: true })
    expect(Number.isNaN(budget)).toBe(false)
    expect(budget).toBe(computeBudgetTokens(FALLBACK_TOKEN_LIMIT, EFFORT_RATIO.high))
  })

  it('caps the budget at maxTokens', () => {
    expect(getThinkingBudget(2048, 'high', KNOWN_MODEL, EFFORT_RATIO)).toBe(2048)
  })
})
