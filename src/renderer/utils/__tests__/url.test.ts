import { describe, expect, it } from 'vitest'

import { isValidProxyUrl } from '../url'

describe('isValidProxyUrl', () => {
  it('accepts the protocols the proxy stack understands', () => {
    expect(isValidProxyUrl('http://localhost')).toBe(true)
    expect(isValidProxyUrl('https://proxy.example.com:8080')).toBe(true)
    expect(isValidProxyUrl('socks://127.0.0.1:1080')).toBe(true)
    expect(isValidProxyUrl('socks5://127.0.0.1:1080')).toBe(true)
    expect(isValidProxyUrl('socks4://127.0.0.1:1080')).toBe(true)
  })

  it('rejects values without a scheme or a host', () => {
    expect(isValidProxyUrl('localhost')).toBe(false)
    expect(isValidProxyUrl('127.0.0.1:1080')).toBe(false)
    expect(isValidProxyUrl('http://')).toBe(false)
    expect(isValidProxyUrl('://x')).toBe(false)
    expect(isValidProxyUrl('://')).toBe(false)
  })

  it('rejects schemes Electron cannot use', () => {
    expect(isValidProxyUrl('foo://example.com')).toBe(false)
    expect(isValidProxyUrl('file:///tmp/socket')).toBe(false)
  })

  it('handles an empty string', () => {
    expect(isValidProxyUrl('')).toBe(false)
  })
})
