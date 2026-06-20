import { describe, expect, it } from 'vitest'

import { isValidUrl } from '../http'

describe('isValidUrl', () => {
  it('returns true for valid http and https URLs', () => {
    expect(isValidUrl('https://example.com')).toBe(true)
    expect(isValidUrl('http://localhost:3000/path?q=1')).toBe(true)
  })

  it('returns false for invalid or unsupported URLs', () => {
    expect(isValidUrl('file:///tmp/test.txt')).toBe(false)
    expect(isValidUrl('notaurl')).toBe(false)
    expect(isValidUrl('')).toBe(false)
  })
})
