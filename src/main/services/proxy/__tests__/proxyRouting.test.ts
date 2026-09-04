import { describe, expect, it } from 'vitest'

import { normalizeProxyEndpoint } from '../proxyRouting'

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
