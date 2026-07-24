import type { RuntimeReasoning } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { computeBudgetTokens, getThinkingBudget, nearestEffortForBudget } from '../reasoning'

const KNOWN_LIMIT = { min: 128, max: 32768 }
const reasoning = { selectableEfforts: ['low', 'high'], thinkingTokenLimits: KNOWN_LIMIT } satisfies RuntimeReasoning

describe('getThinkingBudget', () => {
  it('returns undefined when the selection does not request reasoning', () => {
    expect(getThinkingBudget(undefined, undefined, reasoning)).toBeUndefined()
    expect(getThinkingBudget(undefined, 'none', reasoning)).toBeUndefined()
    expect(getThinkingBudget(undefined, 'default', reasoning)).toBeUndefined()
  })

  it('computes a budget from descriptor limits', () => {
    expect(getThinkingBudget(undefined, 'low', reasoning)).toBe(computeBudgetTokens(KNOWN_LIMIT, 0.05))
  })

  it('returns undefined for missing descriptor limits', () => {
    expect(getThinkingBudget(undefined, 'low', undefined)).toBeUndefined()
  })

  it('caps the budget at maxTokens', () => {
    expect(getThinkingBudget(2048, 'high', reasoning)).toBe(2048)
  })
})

describe('nearestEffortForBudget', () => {
  it('selects the effort whose descriptor-derived budget is closest', () => {
    const limits = { min: 1000, max: 11_000 }

    expect(nearestEffortForBudget(1500, limits)).toBe('low')
    expect(nearestEffortForBudget(6000, limits)).toBe('medium')
    expect(nearestEffortForBudget(9000, limits)).toBe('high')
    expect(nearestEffortForBudget(11_000, limits)).toBe('max')
  })

  it('resolves an exact midpoint upward', () => {
    expect(nearestEffortForBudget(7500, { min: 1000, max: 11_000 })).toBe('high')
  })

  it('returns undefined without complete descriptor limits or for a non-finite budget', () => {
    expect(nearestEffortForBudget(6000, undefined)).toBeUndefined()
    expect(nearestEffortForBudget(6000, { max: 11_000 })).toBeUndefined()
    expect(nearestEffortForBudget(Number.NaN, { min: 1000, max: 11_000 })).toBeUndefined()
  })
})
