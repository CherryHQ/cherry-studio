import { describe, expect, it } from 'vitest'

import { isValidProxyUrl } from '../url'

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
