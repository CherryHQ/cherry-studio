import { describe, expect, it } from 'vitest'

import { ArchiveAdmissionError } from '../../errors'
import { ExtractionBudget } from '../extract'

/**
 * The cumulative actual-byte budget is otherwise unreachable through the full
 * pipeline (per-entry `actual ≤ declared` plus catalog's `declared aggregate ≤
 * total` together bound the actual aggregate), so it is proven directly here as
 * the defense-in-depth layer the review requires.
 */
describe('ExtractionBudget', () => {
  it('permits consumption up to the total ceiling', () => {
    const budget = new ExtractionBudget(10)
    expect(budget.consume(6)).toBeNull()
    expect(budget.consume(4)).toBeNull()
  })

  it('rejects the chunk that pushes cumulative bytes past the total ceiling', () => {
    const budget = new ExtractionBudget(10)
    expect(budget.consume(6)).toBeNull()
    const err = budget.consume(5)
    expect(err).toBeInstanceOf(ArchiveAdmissionError)
    expect(err?.reason).toBe('ceiling-total-bytes')
  })
})
