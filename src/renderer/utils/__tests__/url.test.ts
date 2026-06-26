import { describe, expect, it } from 'vitest'

import { getUrlOriginOrFallback, isValidProxyUrl } from '../url'

describe('url utils', () => {
  it('returns only the origin for valid urls', () => {
    expect(getUrlOriginOrFallback('https://example.com/path?utm_source=newsletter#details')).toBe('https://example.com')
  })

  it('preserves ports in the origin', () => {
    expect(getUrlOriginOrFallback('https://example.com:8443/path')).toBe('https://example.com:8443')
  })

  it('returns the original value for invalid urls', () => {
    expect(getUrlOriginOrFallback('not a url')).toBe('not a url')
  })
})

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
