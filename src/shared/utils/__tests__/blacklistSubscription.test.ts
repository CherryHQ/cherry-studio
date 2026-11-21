import { describe, expect, it } from 'vitest'

import {
  isValidSubscriptionUrl,
  parseBlacklistRuleLine,
  parseUBlacklistSubscription
} from '../blacklistSubscription'

describe('parseBlacklistRuleLine', () => {
  it('keeps valid match patterns', () => {
    expect(parseBlacklistRuleLine('*://*.example.com/*')).toBe('*://*.example.com/*')
    expect(parseBlacklistRuleLine('  https://spam.example/path/*  ')).toBe('https://spam.example/path/*')
  })

  it('keeps valid regex rules', () => {
    expect(parseBlacklistRuleLine('/example\\.(com|net)/')).toBe('/example\\.(com|net)/')
  })

  it('drops invalid rules', () => {
    expect(parseBlacklistRuleLine('not a pattern')).toBeNull()
    expect(parseBlacklistRuleLine('/(unclosed/')).toBeNull()
    expect(parseBlacklistRuleLine('//')).toBeNull()
    expect(parseBlacklistRuleLine('')).toBeNull()
  })
})

describe('parseUBlacklistSubscription', () => {
  it('ignores blank lines and comments', () => {
    const body = ['# Title', '! Last-Modified: 2026', '', '   ', '*://*.a.com/*', '*://*.b.com/*'].join('\n')
    expect(parseUBlacklistSubscription(body)).toEqual({
      rules: ['*://*.a.com/*', '*://*.b.com/*'],
      droppedCount: 0
    })
  })

  it('keeps match patterns and regexes while dropping invalid lines without failing', () => {
    const body = ['*://*.a.com/*', '/b\\.example/', '::: not a rule', '*://*.c.com/*'].join('\n')
    const { rules, droppedCount } = parseUBlacklistSubscription(body)
    expect(rules).toEqual(['*://*.a.com/*', '/b\\.example/', '*://*.c.com/*'])
    expect(droppedCount).toBe(1)
  })

  it('deduplicates repeated rules', () => {
    const body = ['*://*.a.com/*', '*://*.a.com/*'].join('\n')
    expect(parseUBlacklistSubscription(body).rules).toEqual(['*://*.a.com/*'])
  })

  it('caps the number of rules per source', () => {
    const body = Array.from({ length: 10 }, (_, index) => `*://*.host${index}.com/*`).join('\n')
    const { rules } = parseUBlacklistSubscription(body, { maxRules: 3 })
    expect(rules).toHaveLength(3)
  })
})

describe('isValidSubscriptionUrl', () => {
  it('accepts HTTP(S) URLs', () => {
    expect(isValidSubscriptionUrl('https://example.com/list.txt')).toBe(true)
    expect(isValidSubscriptionUrl('http://example.com/list.txt')).toBe(true)
  })

  it('rejects other schemes and malformed URLs', () => {
    expect(isValidSubscriptionUrl('ftp://example.com/list.txt')).toBe(false)
    expect(isValidSubscriptionUrl('file:///etc/passwd')).toBe(false)
    expect(isValidSubscriptionUrl('javascript:alert(1)')).toBe(false)
    expect(isValidSubscriptionUrl('not a url')).toBe(false)
    expect(isValidSubscriptionUrl('')).toBe(false)
  })
})
