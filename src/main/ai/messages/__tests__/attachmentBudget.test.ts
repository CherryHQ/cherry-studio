import { READ_FILE_PAGE_SIZE } from '@shared/ai/builtinTools'
import { describe, expect, it } from 'vitest'

import { allocateAttachmentBudget, allocateInlineCaps } from '../attachmentBudget'

/** One token per character, so allocations read directly as character counts. */
const charTokenizer = { id: 'chars', count: (text: string) => text.length }
const budgetOf = (tokens: number) => ({ tokens, tokenizer: charTokenizer })

describe('allocateAttachmentBudget', () => {
  // The defect this replaces: the cap was `max(READ_FILE_PAGE_SIZE, share)` per
  // file, so N attachments inlined N × 8000 no matter how small the share was.
  it('never exceeds the total, however many files ask for a share', () => {
    const sizes = new Array(1_000).fill(500_000)
    const allocated = allocateAttachmentBudget(sizes, 100_000)

    expect(sum(allocated)).toBeLessThanOrEqual(100_000)
    expect(sum(allocated)).toBeGreaterThan(0)
    expect(1_000 * READ_FILE_PAGE_SIZE).toBeGreaterThan(100_000) // the old floor would have blown it
  })

  // An equal split would truncate the big file at half the pool while the small
  // one leaves its half unused.
  it('serves small files whole and gives the rest to the large ones', () => {
    expect(allocateAttachmentBudget([10, 1_000], 100)).toEqual([10, 90])
  })

  it('leaves the pool alone when everything fits', () => {
    expect(allocateAttachmentBudget([10, 20], 1_000)).toEqual([10, 20])
  })

  it('allocates nothing rather than throwing on an exhausted or absent pool', () => {
    expect(allocateAttachmentBudget([100, 200], 0)).toEqual([0, 0])
    expect(allocateAttachmentBudget([100], -5)).toEqual([0])
    expect(allocateAttachmentBudget([], 100)).toEqual([])
  })
})

describe('allocateInlineCaps', () => {
  it('caps each body within the shared pool', () => {
    const caps = allocateInlineCaps(['a'.repeat(50), 'b'.repeat(50)], budgetOf(60))

    expect(caps).toEqual([30, 30])
  })

  // A cap in tokens has to become a cut point in characters, and the two differ
  // per script — CJK runs ~1 char/token where English runs ~4.
  it('converts a token cap using each body own measured ratio', () => {
    const twoCharsPerToken = { id: 'halves', count: (text: string) => Math.ceil(text.length / 2) }
    const [cap] = allocateInlineCaps(['x'.repeat(100)], { tokens: 10, tokenizer: twoCharsPerToken })

    expect(cap).toBe(20)
  })

  it('does not cut a body that fits', () => {
    expect(allocateInlineCaps(['short'], budgetOf(1_000))).toEqual([5])
  })

  it('survives an empty body without dividing by zero', () => {
    expect(allocateInlineCaps([''], budgetOf(0))).toEqual([0])
  })
})

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}
