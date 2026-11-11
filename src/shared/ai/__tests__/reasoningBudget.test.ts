import { describe, expect, it } from 'vitest'

import type { RuntimeReasoning } from '@shared/data/types/model'

import { getThinkingBudget, nearestEffortForBudget } from '../reasoning'

const KNOWN_LIMIT = { min: 128, max: 32768 }
const reasoning = { selectableEfforts: ['low', 'high'], thinkingTokenLimits: KNOWN_LIMIT } satisfies RuntimeReasoning

describe('getThinkingBudget', () => {
  it('returns undefined when the selection does not request reasoning', () => {
    expect(getThinkingBudget(undefined, undefined, reasoning)).toBeUndefined()
    expect(getThinkingBudget(undefined, 'none', reasoning)).toBeUndefined()
    expect(getThinkingBudget(undefined, 'default', reasoning)).toBeUndefined()
  })

  it('returns undefined for missing descriptor limits', () => {
    expect(getThinkingBudget(undefined, 'low', undefined)).toBeUndefined()
  })

  it('caps the budget at maxTokens', () => {
    expect(getThinkingBudget(2048, 'high', reasoning)).toBe(2048)
  })
})

describe('nearestEffortForBudget', () => {
  it('returns undefined without complete descriptor limits or for a non-finite budget', () => {
    expect(nearestEffortForBudget(6000, undefined)).toBeUndefined()
    expect(nearestEffortForBudget(6000, { max: 11_000 })).toBeUndefined()
    expect(nearestEffortForBudget(Number.NaN, { min: 1000, max: 11_000 })).toBeUndefined()
  })
})
