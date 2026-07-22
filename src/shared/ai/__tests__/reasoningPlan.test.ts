import type { RuntimeReasoning } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { computeBudgetTokens, resolveBudgetTokens } from '../reasoning'

const reasoning = {
  selectableEfforts: ['high'],
  thinkingTokenLimits: { min: 1024, max: 64_000 }
} satisfies RuntimeReasoning

describe('resolveBudgetTokens', () => {
  it('computes from descriptor-declared limits', () => {
    expect(resolveBudgetTokens('high', reasoning)).toBe(computeBudgetTokens(reasoning.thinkingTokenLimits, 0.8))
  })

  it('does not infer limits when the descriptor omits them', () => {
    expect(resolveBudgetTokens('high', undefined)).toBeUndefined()
    expect(resolveBudgetTokens('high', { selectableEfforts: ['high'] })).toBeUndefined()
  })
})
