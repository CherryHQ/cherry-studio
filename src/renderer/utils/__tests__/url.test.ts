import { describe, expect, it } from 'vitest'

import { isValidHttpUrl, isValidProxyUrl } from '../url'

describe('isValidProxyUrl', () => {
  it('should return true for string containing "://"', () => {
    expect(isValidProxyUrl('http://localhost')).toBe(true)
    expect(isValidProxyUrl('socks5://127.0.0.1:1080')).toBe(true)
  })

  it('should return false for string not containing "://"', () => {
    expect(isValidProxyUrl('localhost')).toBe(false)
    expect(isValidProxyUrl('127.0.0.1:1080')).toBe(false)
  })

  it('should handle empty string', () => {
    expect(isValidProxyUrl('')).toBe(false)
  })

  it('should return true for only "://"', () => {
    expect(isValidProxyUrl('://')).toBe(true)
  })
})

describe('isValidHttpUrl', () => {
  it('should return true for http and https urls', () => {
    expect(isValidHttpUrl('http://example.com')).toBe(true)
    expect(isValidHttpUrl('https://example.com/path?q=1')).toBe(true)
  })

  it('should return false for non-http(s) schemes', () => {
    expect(isValidHttpUrl('ftp://example.com')).toBe(false)
    expect(isValidHttpUrl('file:///tmp/foo')).toBe(false)
  })

  it('should return false for unparseable text', () => {
    expect(isValidHttpUrl('abc')).toBe(false)
    expect(isValidHttpUrl('')).toBe(false)
  })
})
