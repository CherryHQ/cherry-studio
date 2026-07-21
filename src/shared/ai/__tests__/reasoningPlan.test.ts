import type { RuntimeReasoning } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { computeBudgetTokens } from '../reasoningBudget'
import { resolveBudgetTokens } from '../reasoningPlan'

const reasoning = {
  type: 'anthropic',
  supportedEfforts: ['high'],
  thinkingTokenLimits: { min: 1024, max: 64_000 }
} satisfies RuntimeReasoning

describe('resolveBudgetTokens', () => {
  it('computes from descriptor-declared limits', () => {
    expect(resolveBudgetTokens('high', reasoning)).toBe(computeBudgetTokens(reasoning.thinkingTokenLimits, 0.8))
  })

  it('does not infer limits when the descriptor omits them', () => {
    expect(resolveBudgetTokens('high', undefined)).toBeUndefined()
    expect(resolveBudgetTokens('high', { type: 'anthropic', supportedEfforts: ['high'] })).toBeUndefined()
  })

  it('returns undefined for an effort without a declared ratio', () => {
    expect(resolveBudgetTokens('ultra', reasoning)).toBeUndefined()
  })
})
