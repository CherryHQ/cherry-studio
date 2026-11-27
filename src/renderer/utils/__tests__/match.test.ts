import { describe, expect, it } from 'vitest'

import { includeKeywords, matchKeywordsInString } from '../match'

describe('match', () => {
  describe('includeKeywords', () => {
    it('should return true if keywords is empty or blank', () => {
      expect(includeKeywords('hello world', '')).toBe(true)
      expect(includeKeywords('hello world', '   ')).toBe(true)
    })

    it('should return false if target is empty', () => {
      expect(includeKeywords('', 'hello')).toBe(false)
      expect(includeKeywords(undefined as any, 'hello')).toBe(false)
    })

    it('should match all keywords (case-insensitive, whitespace split)', () => {
      expect(includeKeywords('Hello World', 'hello')).toBe(true)
      expect(includeKeywords('Hello World', 'world')).toBe(true)
      expect(includeKeywords('Hello World', 'hello world')).toBe(true)
      expect(includeKeywords('Hello World', 'world hello')).toBe(true)
      expect(includeKeywords('Hello World', 'HELLO')).toBe(true)
      expect(includeKeywords('Hello World', 'hello   world')).toBe(true)
      expect(includeKeywords('Hello\nWorld', 'hello world')).toBe(true)
    })

    it('matches Chinese initials and Latin tokens together without dropping any keyword', () => {
      expect(includeKeywords('API 知识库', 'ZSK api')).toBe(true)
      expect(includeKeywords('API 知识库', ['api', 'zsk'])).toBe(true)
      expect(includeKeywords('API 知识库', 'zsk missing')).toBe(false)
      expect(includeKeywords('API 知识库', 'api zk')).toBe(false)
    })

    it('should return false if any keyword is not included', () => {
      expect(includeKeywords('Hello World', 'hello foo')).toBe(false)
      expect(includeKeywords('Hello World', 'foo')).toBe(false)
    })

    it('should ignore blank keywords', () => {
      expect(includeKeywords('Hello World', '   hello   ')).toBe(true)
      expect(includeKeywords('Hello World', 'hello   ')).toBe(true)
      expect(includeKeywords('Hello World', '   ')).toBe(true)
    })

    it('should handle keyword array', () => {
      expect(includeKeywords('Hello World', ['hello', 'world'])).toBe(true)
      expect(includeKeywords('Hello World', ['Hello', 'World'])).toBe(true)
      expect(includeKeywords('Hello World', ['hello', 'foo'])).toBe(false)
      expect(includeKeywords('Hello World', ['hello', ''])).toBe(true)
    })
  })

  describe('matchKeywordsInString', () => {
    it('should delegate to includeKeywords with string', () => {
      expect(matchKeywordsInString('foo', 'foo bar')).toBe(true)
      expect(matchKeywordsInString('bar', 'foo bar')).toBe(true)
      expect(matchKeywordsInString('baz', 'foo bar')).toBe(false)
    })
  })
})
