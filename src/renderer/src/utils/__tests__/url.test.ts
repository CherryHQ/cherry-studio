import { describe, expect, it } from 'vitest'

import { getUrlOriginOrFallback } from '../url'

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
