import type { Model, Provider } from '@renderer/types'
import { describe, expect, it, vi } from 'vitest'

import { includeKeywords, keywordsMatchModel, keywordsMatchProvider, keywordsMatchString } from '../match'

// mock i18n for getFancyProviderName
vi.mock('@renderer/i18n', () => ({
  default: {
    t: (key: string) => `i18n:${key}`
  }
}))

describe('match', () => {
  const provider: Provider = {
    id: '12345',
    type: 'openai',
    name: 'OpenAI',
    apiKey: '',
    apiHost: '',
    models: [],
    isSystem: false
  }
  const sysProvider: Provider = {
    ...provider,
    id: 'sys',
    name: 'SystemProvider',
    isSystem: true
  }

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

  describe('keywordsMatchString', () => {
    it('should delegate to includeKeywords with string', () => {
      expect(keywordsMatchString('foo', 'foo bar')).toBe(true)
      expect(keywordsMatchString('bar', 'foo bar')).toBe(true)
      expect(keywordsMatchString('baz', 'foo bar')).toBe(false)
    })
  })

  describe('keywordsMatchProvider', () => {
    it('should match non-system provider by name only, not id', () => {
      expect(keywordsMatchProvider('OpenAI', provider)).toBe(true)
      expect(keywordsMatchProvider('12345', provider)).toBe(false) // Should NOT match by id
      expect(keywordsMatchProvider('foo', provider)).toBe(false)
    })

    it('should match i18n name for system provider', () => {
      expect(keywordsMatchProvider('i18n:provider.sys', sysProvider)).toBe(true)
      expect(keywordsMatchProvider('SystemProvider', sysProvider)).toBe(false)
    })
  })

  describe('keywordsMatchModel', () => {
    const model: Model = {
      id: 'gpt-4.1',
      provider: 'openai',
      name: 'GPT-4.1',
      group: 'gpt'
    }

    it('should match model name only if provider not given', () => {
      expect(keywordsMatchModel('gpt-4.1', model)).toBe(true)
      expect(keywordsMatchModel('openai', model)).toBe(false)
    })

    it('should match model name and provider name if provider given', () => {
      expect(keywordsMatchModel('gpt-4.1 openai', model, provider)).toBe(true)
      expect(keywordsMatchModel('gpt-4.1', model, provider)).toBe(true)
      expect(keywordsMatchModel('foo', model, provider)).toBe(false)
    })

    it('should match model name and i18n provider name for system provider', () => {
      expect(keywordsMatchModel('gpt-4.1 i18n:provider.sys', model, sysProvider)).toBe(true)
      expect(keywordsMatchModel('i18n:provider.sys', model, sysProvider)).toBe(true)
      expect(keywordsMatchModel('SystemProvider', model, sysProvider)).toBe(false)
    })

    it('should match model by id when name is customized', () => {
      const customNameModel: Model = {
        id: 'claude-3-opus-20240229',
        provider: 'anthropic',
        name: 'Opus (Custom Name)',
        group: 'claude'
      }

      // search by parts of ID
      expect(keywordsMatchModel('claude', customNameModel)).toBe(true)
      expect(keywordsMatchModel('opus', customNameModel)).toBe(true)
      expect(keywordsMatchModel('20240229', customNameModel)).toBe(true)

      // search by parts of custom name
      expect(keywordsMatchModel('Custom', customNameModel)).toBe(true)
      expect(keywordsMatchModel('Opus Name', customNameModel)).toBe(true)

      // search by both
      expect(keywordsMatchModel('claude custom', customNameModel)).toBe(true)

      // should not match
      expect(keywordsMatchModel('sonnet', customNameModel)).toBe(false)
    })
  })
})
