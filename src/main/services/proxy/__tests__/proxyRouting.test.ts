import { describe, expect, it } from 'vitest'

import { normalizeProxyEndpoint, proxyUrlFromChromiumRoute } from '../proxyRouting'

describe('Chromium route to pinned proxy', () => {
  it.each([
    ['PROXY proxy.example:8080; DIRECT', 'http://proxy.example:8080/'],
    ['HTTPS proxy.example:443', 'https://proxy.example/'],
    ['SOCKS proxy.example:1080', 'socks4://proxy.example:1080'],
    ['SOCKS5 [::1]:1080', 'socks5://[::1]:1080'],
    ['DIRECT; PROXY unused.example:8080', undefined]
  ])('selects the first route only: %s', (route, expected) => {
    expect(proxyUrlFromChromiumRoute(route)).toBe(expected)
  })

  it('keeps configured credentials only for the same proxy endpoint', () => {
    const configured = 'http://user:TestOnlyPassword@proxy.example:8080'
    expect(proxyUrlFromChromiumRoute('PROXY proxy.example:8080', configured)).toBe(`${configured}/`)
    expect(proxyUrlFromChromiumRoute('PROXY other.example:8080', configured)).toBe('http://other.example:8080/')
  })

  it.each(['', 'UNKNOWN route:8080', 'SOCKS5 missing-port'])(
    'fails closed on malformed/unsupported routes: %s',
    (route) => {
      expect(() => proxyUrlFromChromiumRoute(route)).toThrow()
    }
  )
})

describe('proxy endpoint normalization', () => {
  it('normalizes a SOCKS endpoint once in the main process', () => {
    expect(normalizeProxyEndpoint('socks5://user%40name:p%3Ass@proxy.example:1080')).toEqual({
      kind: 'socks',
      version: 5,
      host: 'proxy.example',
      port: 1080,
      userId: 'user@name',
      password: 'p:ss',
      displayOrigin: 'socks5://proxy.example:1080'
    })
  })

  it('rejects a SOCKS endpoint without a port before it leaves the main process', () => {
    expect(() => normalizeProxyEndpoint('socks5://proxy.example')).toThrow('SOCKS proxy URL must include a valid port')
  })
})
