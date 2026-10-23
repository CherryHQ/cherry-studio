import { describe, expect, it } from 'vitest'

import { allocateInlineCaps, fitsInlineImageBudget } from '../attachmentBudget'

const charTokenizer = { id: 'chars', count: (text: string) => text.length }
const budgetOf = (tokens: number) => ({ tokens, tokenizer: charTokenizer })

describe('fitsInlineImageBudget', () => {
  const dims = { width: 128, height: 128 }
  it('prices text fragments and images together including the exact boundary', () => {
    const budget = { ...budgetOf(100), imageTokens: () => 30 }
    expect(fitsInlineImageBudget(budget, ['x'.repeat(70)], [dims])).toBe(true)
    expect(fitsInlineImageBudget(budget, ['x'.repeat(71)], [dims])).toBe(false)
    expect(fitsInlineImageBudget(budget, ['x'.repeat(80)], [dims, dims, dims])).toBe(false)
    expect(allocateInlineCaps(['x'.repeat(80)], budget)).toEqual([80])
  })
  it('rejects unpriced images but still permits text-only output', () => {
    expect(fitsInlineImageBudget(budgetOf(100), ['text'], [dims])).toBe(false)
    expect(fitsInlineImageBudget(budgetOf(100), ['text'], [])).toBe(true)
  })
  it('counts separately emitted fragments separately instead of underpricing a merged string', () => {
    const budget = {
      tokens: 1,
      tokenizer: { id: 'pairs', count: (text: string) => Math.ceil(text.length / 2) },
      imageTokens: () => 0
    }
    expect(fitsInlineImageBudget(budget, ['a', 'b'], [])).toBe(false)
    expect(fitsInlineImageBudget(budget, ['ab'], [])).toBe(true)
  })
})
