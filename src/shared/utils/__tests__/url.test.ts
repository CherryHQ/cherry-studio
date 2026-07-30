import { describe, expect, it } from 'vitest'

import { isHttpUrl } from '../url'

describe('isHttpUrl', () => {
  it('returns true for valid http and https URLs', () => {
    expect(isHttpUrl('https://example.com')).toBe(true)
    expect(isHttpUrl('http://localhost:3000/path?q=1')).toBe(true)
  })

  it('returns false for invalid or unsupported URLs', () => {
    expect(isHttpUrl('file:///tmp/test.txt')).toBe(false)
    expect(isHttpUrl('notaurl')).toBe(false)
    expect(isHttpUrl('')).toBe(false)
  })

  // A bare host is the shape a model actually tends to emit for web_fetch, and the one that used to
  // pass the tool schema and resurface downstream as a phantom network error.
  it('returns false for a scheme-less host', () => {
    expect(isHttpUrl('example.com')).toBe(false)
    expect(isHttpUrl('//example.com')).toBe(false)
  })
})
