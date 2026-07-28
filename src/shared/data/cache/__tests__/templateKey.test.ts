import { describe, expect, it } from 'vitest'

import { findMatchingSharedCacheSchemaKey, isTemplateKey, templateToRegex } from '../templateKey'

describe('isTemplateKey', () => {
  it('returns true when key contains ${...} placeholder', () => {
    expect(isTemplateKey('scroll.position.${id}')).toBe(true)
    expect(isTemplateKey('entity.cache.${type}_${id}')).toBe(true)
    expect(isTemplateKey('web_search.provider.last_used_key.${providerId}')).toBe(true)
  })

  it('returns false for plain keys without placeholder', () => {
    expect(isTemplateKey('app.user.avatar')).toBe(false)
    expect(isTemplateKey('chat.multi_select_mode')).toBe(false)
  })

  it('returns false when only one of ${ or } is present', () => {
    expect(isTemplateKey('app.$foo')).toBe(false)
    expect(isTemplateKey('app.foo}')).toBe(false)
  })
})

describe('templateToRegex', () => {
  it('matches single placeholder with word characters and hyphens', () => {
    const regex = templateToRegex('scroll.position.${id}')
    expect(regex.test('scroll.position.topic123')).toBe(true)
    expect(regex.test('scroll.position.topic-123')).toBe(true)
    expect(regex.test('scroll.position.abc_def')).toBe(true)
  })

  it('rejects empty dynamic segment', () => {
    const regex = templateToRegex('scroll.position.${id}')
    expect(regex.test('scroll.position.')).toBe(false)
  })

  it('rejects dots in dynamic segment (dot is structural separator)', () => {
    const regex = templateToRegex('scroll.position.${id}')
    expect(regex.test('scroll.position.topic.123')).toBe(false)
  })

  it('rejects non-ASCII characters in dynamic segment (contract test for [\\w\\-]+)', () => {
    const regex = templateToRegex('web_search.provider.last_used_key.${providerId}')
    expect(regex.test('web_search.provider.last_used_key.中文id')).toBe(false)
    expect(regex.test('web_search.provider.last_used_key.emoji😀')).toBe(false)
  })

  it('does not match unrelated keys', () => {
    const regex = templateToRegex('scroll.position.${id}')
    expect(regex.test('other.key.123')).toBe(false)
    expect(regex.test('scroll.positions.123')).toBe(false)
  })

  it('handles multiple placeholders', () => {
    const regex = templateToRegex('entity.cache.${type}_${id}')
    expect(regex.test('entity.cache.user_456')).toBe(true)
    expect(regex.test('entity.cache.product_abc')).toBe(true)
    expect(regex.test('entity.cache.user_')).toBe(false)
    expect(regex.test('entity.cache._456')).toBe(false)
  })

  it('placeholder variable name does not affect matching', () => {
    const a = templateToRegex('web_search.provider.last_used_key.${providerId}')
    const b = templateToRegex('web_search.provider.last_used_key.${foo}')
    expect(a.source).toBe(b.source)
    expect(a.test('web_search.provider.last_used_key.google')).toBe(true)
    expect(b.test('web_search.provider.last_used_key.google')).toBe(true)
  })

  it('escapes regex special characters in the template prefix', () => {
    // dots must be treated as literal dots, not "any character"
    const regex = templateToRegex('a.b.${id}')
    expect(regex.test('aXb.value')).toBe(false)
    expect(regex.test('a.b.value')).toBe(true)
  })
})

describe('findMatchingSharedCacheSchemaKey', () => {
  it('returns the exact fixed key when it matches a schema entry', () => {
    expect(findMatchingSharedCacheSchemaKey('chat.web_search.active_searches')).toBe('chat.web_search.active_searches')
  })

  it('returns the template pattern when concrete key matches a template entry', () => {
    expect(findMatchingSharedCacheSchemaKey('web_search.provider.last_used_key.google')).toBe(
      'web_search.provider.last_used_key.${providerId}'
    )
    expect(findMatchingSharedCacheSchemaKey('ocr.provider.last_used_key.mistral')).toBe(
      'ocr.provider.last_used_key.${providerId}'
    )
  })

  it('returns undefined when the key matches nothing', () => {
    expect(findMatchingSharedCacheSchemaKey('unknown.key')).toBeUndefined()
    expect(findMatchingSharedCacheSchemaKey('web_search.provider.last_used_key.')).toBeUndefined()
  })
})
