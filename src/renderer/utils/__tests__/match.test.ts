import type { Provider, SystemProvider } from '@renderer/types'
import { describe, expect, it, vi } from 'vitest'

import { includeKeywords, matchKeywordsInProvider, matchKeywordsInString } from '../match'

// Mock i18n to return English provider labels
vi.mock('@renderer/i18n/label', () => ({
  getProviderLabel: vi.fn((id: string) => {
    const labelMap: Record<string, string> = {
      dashscope: 'Alibaba Cloud',
      openai: 'OpenAI',
      anthropic: 'Anthropic'
    }
    return labelMap[id] || id
  })
}))

describe('match', () => {
  const provider = {
    id: '12345',
    type: 'openai',
    name: 'OpenAI',
    apiKey: '',
    apiHost: '',
    models: [],
    isSystem: false
  } as const satisfies Provider

  const sysProvider: SystemProvider = {
    ...provider,
    id: 'dashscope',
    name: 'doesnt matter',
    isSystem: true
  } as const

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

  describe('matchKeywordsInProvider', () => {
    it('should match non-system provider by name and id', () => {
      expect(matchKeywordsInProvider('OpenAI', provider)).toBe(true)
      expect(matchKeywordsInProvider('12345', provider)).toBe(true) // Should match by id
      expect(matchKeywordsInProvider('foo', provider)).toBe(false)
    })

    it('should match i18n name, id, and name for system provider', () => {
      expect(matchKeywordsInProvider('dashscope', sysProvider)).toBe(true)
      expect(matchKeywordsInProvider('Alibaba', sysProvider)).toBe(true)
      // system provider 现在也可以通过 name 字段匹配
      expect(matchKeywordsInProvider('doesnt matter', sysProvider)).toBe(true)
    })
  })
})
