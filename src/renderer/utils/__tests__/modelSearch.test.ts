import { describe, expect, it } from 'vitest'

import { getSearchMatchScore, type ModelSearchField } from '../modelSearch'

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

  it('should return null for queries with mixed punctuation tokens (where some normalize to empty)', () => {
    // Current behavior: 'gpt :' splits into ['gpt', ':']. Since ':' normalizes to empty,
    // getKeywordMatchScore(':', fields) returns null, which makes the whole search return null.
    expect(getSearchMatchScore('gpt :', fields)).toBeNull()
    expect(getSearchMatchScore('gpt ---', fields)).toBeNull()
  })

  describe('ranking and abbreviations contract tests', () => {
    const testFields = [
      { value: 'DeepSeek-V3', weight: 0, allowAbbreviation: true },
      { value: 'DeepSeekV4', weight: 0, allowAbbreviation: true }
    ]

    it('should match token initials (e.g., dsv)', () => {
      // dsv matches DeepSeek-V3 (initials is dsv)
      const score = getSearchMatchScore('dsv', testFields)
      expect(score).not.toBeNull()
    })

    it('should match ordered-character abbreviation (e.g., dv)', () => {
      // dv matches DeepSeekV4 (d...v...) via ordered abbreviation
      const score = getSearchMatchScore('dv', testFields)
      expect(score).not.toBeNull()
    })

    it('should not match abbreviation when allowAbbreviation is false', () => {
      const fieldsNoAbbr = [{ value: 'DeepSeek-V3', weight: 0, allowAbbreviation: false }]
      expect(getSearchMatchScore('dsv', fieldsNoAbbr)).toBeNull()
      expect(getSearchMatchScore('dv', fieldsNoAbbr)).toBeNull()
    })

    it('should rank name > apiModelId > id > group > description based on weights', () => {
      const nameField: ModelSearchField = { value: 'test-model', weight: 0, allowAbbreviation: true }
      const apiField: ModelSearchField = { value: 'test-api-id', weight: 1, allowAbbreviation: true }
      const idField: ModelSearchField = { value: 'test-id', weight: 1, allowAbbreviation: true }
      const groupField: ModelSearchField = { value: 'test-group', weight: 2, allowAbbreviation: true }
      const descField: ModelSearchField = { value: 'test-desc', weight: 30, allowAbbreviation: true }

      const scoreName = getSearchMatchScore('test', [nameField])
      const scoreApi = getSearchMatchScore('test', [apiField])
      const scoreId = getSearchMatchScore('test', [idField])
      const scoreGroup = getSearchMatchScore('test', [groupField])
      const scoreDesc = getSearchMatchScore('test', [descField])

      // Lower score is better
      expect(scoreName!).toBeLessThan(scoreApi!)
      expect(scoreApi!).toBe(scoreId!) // same weight
      expect(scoreId!).toBeLessThan(scoreGroup!)
      expect(scoreGroup!).toBeLessThan(scoreDesc!)
    })

    it('should rank a name abbreviation (weight 0) higher than a description raw match (weight 30)', () => {
      const fieldsToCompare = [
        { value: 'DeepSeek-V3', weight: 0, allowAbbreviation: true }, // name
        { value: 'dsv-model-description', weight: 30, allowAbbreviation: false } // description
      ]

      // Search 'dsv':
      // matches DeepSeek-V3 via token initials (tier offset 1500)
      // matches description via raw substring (tier offset 0, but weight 30 -> 3000)
      const scoreNameAbbr = getSearchMatchScore('dsv', [fieldsToCompare[0]])
      const scoreDescRaw = getSearchMatchScore('dsv', [fieldsToCompare[1]])

      expect(scoreNameAbbr!).toBeLessThan(scoreDescRaw!)
    })
  })
})
