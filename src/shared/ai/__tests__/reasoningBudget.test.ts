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

  // Characterization of the THINKING_TOKEN_MAP families (#16598 migration
  // oracle): one exemplar per family, high effort (0.8), no maxTokens cap.
  // budget = max(1024, floor((max - min) * 0.8 + min)).
  it.each([
    ['gemini-2.5-flash-lite', 19_763], // {512, 24576}
    ['gemini-2.5-flash', 19_660], // {0, 24576}
    ['gemini-2.5-pro', 26_240], // {128, 32768}
    ['qwen3-235b-a22b-thinking-2507', 65_536], // {0, 81920}
    ['qwen-plus', 65_536], // {0, 81920}
    ['qwen-turbo', 31_129], // {0, 38912}
    ['qwen3-max', 65_536], // {0, 81920}
    ['qwen3.5-397b-a17b', 65_536], // {0, 81920}
    ['qwen3-32b', 31_334], // {1024, 38912}
    ['claude-opus-4-7', 102_604], // {1024, 128000}
    ['claude-opus-4-6', 102_604], // {1024, 128000}
    ['claude-sonnet-4-6', 51_404], // {1024, 64000}
    ['claude-sonnet-4-5', 51_404], // {1024, 64000}
    ['claude-opus-4-1', 25_804], // {1024, 32000}
    ['claude-sonnet-4', 51_404], // {1024, 64000}
    ['claude-3-7-sonnet', 51_404], // {1024, 64000}
    ['baichuan-m3', 24_000], // {0, 30000}
    ['gemma-4-26b', 24_780], // {1024, 30720}
    ['hunyuan-a13b', 24_576], // {0, 30720}
    ['glm-4.6', 24_576], // {0, 30720}
    ['mimo-v2-flash', 24_576], // {0, 30720}
    ['kimi-k2.5', 24_576], // {0, 30720}
    ['doubao-seed-1-6-250615', 24_576] // {0, 30720}
  ])('freezes the family budget for %s at high effort', (modelId, expected) => {
    expect(getThinkingBudget(undefined, 'high', modelId, { high: 0.8 })).toBe(expected)
  })
})
