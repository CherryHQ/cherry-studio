import { describe, expect, it } from 'vitest'

import { getSearchMatchScore } from '../modelSearch'

describe('modelSearch', () => {
  const fields = [
    { value: 'GPT-4o', weight: 0, allowAbbreviation: true },
    { value: 'gpt-4o-mini', weight: 1, allowAbbreviation: true }
  ]

  it('should return 0 for empty keywords', () => {
    expect(getSearchMatchScore('', fields)).toBe(0)
    expect(getSearchMatchScore('   ', fields)).toBe(0)
  })

  it('should match exact text case-insensitively', () => {
    const score = getSearchMatchScore('gpt', fields)
    expect(score).not.toBeNull()
  })

  it('should match normalized segment (ignore punctuation)', () => {
    // GPT-4o normalize to gpt4o
    const score = getSearchMatchScore('gpt4o', fields)
    expect(score).not.toBeNull()
  })

  it('should return null for punctuation-only keyword', () => {
    expect(getSearchMatchScore(':', fields)).toBeNull()
    expect(getSearchMatchScore('---', fields)).toBeNull()
    expect(getSearchMatchScore('   :   ', fields)).toBeNull()
  })

  it('should return null if any keyword does not match', () => {
    expect(getSearchMatchScore('gpt claude', fields)).toBeNull()
  })

  it('should rank exact matches higher (lower score is better)', () => {
    const scoreExact = getSearchMatchScore('gpt-4o', fields)
    const scoreAbbr = getSearchMatchScore('g4', fields) // initials: g4 for gpt-4o

    // Low score is better/higher rank in sortBy
    expect(scoreExact).toBeLessThan(scoreAbbr!)
  })
})
