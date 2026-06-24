import { buildKeywordRegexes, type KeywordMatchMode, splitKeywordsToTerms } from '@shared/utils/keywordSearch'
import { describe, expect, it } from 'vitest'

function buildSingleKeywordRegex(term: string, matchMode: KeywordMatchMode) {
  const [regex] = buildKeywordRegexes([term], { matchMode })
  return regex
}

describe('keywordSearch', () => {
  describe('splitKeywordsToTerms', () => {
    it('splits by whitespace and lowercases', () => {
      expect(splitKeywordsToTerms('  Foo\tBAR \n baz  ')).toEqual(['foo', 'bar', 'baz'])
    })

    it('returns empty array for empty input', () => {
      expect(splitKeywordsToTerms('')).toEqual([])
    })

    describe('phrase search (quoted substrings)', () => {
      it('extracts double-quoted phrases as single terms', () => {
        expect(splitKeywordsToTerms('"machine learning" deep')).toEqual(['machine learning', 'deep'])
      })

      it('extracts single-quoted phrases as single terms', () => {
        expect(splitKeywordsToTerms("'neural network' model")).toEqual(['neural network', 'model'])
      })

      it('handles multiple quoted phrases', () => {
        expect(splitKeywordsToTerms('"hello world" "foo bar"')).toEqual(['hello world', 'foo bar'])
      })

      it('handles mixed quoted and unquoted terms', () => {
        expect(splitKeywordsToTerms('test "some phrase" end')).toEqual(['test', 'some phrase', 'end'])
      })

      it('handles unclosed quotes gracefully', () => {
        expect(splitKeywordsToTerms('"unclosed phrase')).toEqual(['unclosed phrase'])
      })

      it('skips empty quotes', () => {
        expect(splitKeywordsToTerms('"" hello')).toEqual(['hello'])
      })
    })
  })

  describe('AND logic with buildKeywordRegexes', () => {
    it('every() returns true when all terms are present', () => {
      const terms = splitKeywordsToTerms('hello world')
      const regexes = buildKeywordRegexes(terms, { matchMode: 'substring', flags: 'i' })
      expect(regexes.every((r) => r.test('hello world'))).toBe(true)
      expect(regexes.every((r) => r.test('world of hello'))).toBe(true)
    })

    it('every() returns false when only some terms are present', () => {
      const terms = splitKeywordsToTerms('hello world')
      const regexes = buildKeywordRegexes(terms, { matchMode: 'substring', flags: 'i' })
      expect(regexes.every((r) => r.test('hello only'))).toBe(false)
      expect(regexes.every((r) => r.test('world only'))).toBe(false)
    })

    it('every() works with phrase search', () => {
      const terms = splitKeywordsToTerms('"machine learning" deep')
      const regexes = buildKeywordRegexes(terms, { matchMode: 'substring', flags: 'i' })
      expect(regexes.every((r) => r.test('deep machine learning is great'))).toBe(true)
      expect(regexes.every((r) => r.test('deep learning but not machine'))).toBe(false)
    })
  })

  describe('buildKeywordRegex (whole-word)', () => {
    const matchMode: KeywordMatchMode = 'whole-word'

    it('matches standalone tokens but not substrings inside words', () => {
      const regex = buildSingleKeywordRegex('sms', matchMode)
      expect(regex.test('sms')).toBe(true)
      expect(regex.test('sms,')).toBe(true)
      expect(regex.test('use sms now')).toBe(true)
      expect(regex.test('mechanisms')).toBe(false)
    })

    it('does not match inside longer alphanumeric strings (e.g. API keys)', () => {
      const regex = buildSingleKeywordRegex('sms', matchMode)
      expect(regex.test('IMr4WSMS5dwa52')).toBe(false)
    })

    it('treats underscores and punctuation as token boundaries', () => {
      const regex = buildSingleKeywordRegex('sms', matchMode)
      expect(regex.test('sms_service')).toBe(true)
      expect(regex.test('sms-service')).toBe(true)
      expect(regex.test('smss')).toBe(false)
    })

    it('does not match inside non-ASCII words', () => {
      const regex = buildSingleKeywordRegex('ana', matchMode)
      expect(regex.test('mañana')).toBe(false)
      expect(regex.test('ana')).toBe(true)
    })

    it('CJK terms degrade to substring in whole-word mode', () => {
      const regex = buildSingleKeywordRegex('组合优于', matchMode)
      expect(regex.test('投资组合优于其他策略')).toBe(true)
      expect(regex.test('组合优于')).toBe(true)
    })

    it('CJK whole-word still does not match partial substring across non-CJK boundary', () => {
      const regex = buildSingleKeywordRegex('组合优于', matchMode)
      expect(regex.test('abc组合优于def')).toBe(true)
    })
  })

  describe('buildKeywordRegex (substring)', () => {
    const matchMode: KeywordMatchMode = 'substring'

    it('matches substrings inside other words', () => {
      const regex = buildSingleKeywordRegex('sms', matchMode)
      expect(regex.test('mechanisms')).toBe(true)
      expect(regex.test('IMr4WSMS5dwa52')).toBe(true)
    })
  })

  describe('buildKeywordRegexes', () => {
    it('builds one regex per term', () => {
      const regexes = buildKeywordRegexes(['sms', 'mms'], { matchMode: 'whole-word', flags: 'i' })
      expect(regexes).toHaveLength(2)
      expect(regexes.some((regex) => regex.test('SMS'))).toBe(true)
      expect(regexes.some((regex) => regex.test('MMS'))).toBe(true)
      expect(regexes.some((regex) => regex.test('mechanisms'))).toBe(false)
    })
  })
})
