import { describe, expect, it } from 'vitest'

import { createProxyRoutingSnapshot, normalizeProxyEndpoint } from '../proxyRouting'

describe('proxy routing snapshot', () => {
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

  it('carries the bypass rules themselves, so the consumer can judge origins nobody enumerated', () => {
    const endpoint = normalizeProxyEndpoint('socks5://proxy.example:1080')!

    expect(createProxyRoutingSnapshot(7, endpoint, ['huggingface.co', '*.hf.co'])).toEqual({
      version: 7,
      mode: 'proxy',
      endpoint,
      bypassRules: ['huggingface.co', '*.hf.co']
    })
  })

  it('copies endpoint and rules so a later configure() cannot mutate a snapshot in flight', () => {
    const endpoint = normalizeProxyEndpoint('socks5://proxy.example:1080')!
    const rules = ['huggingface.co']
    const snapshot = createProxyRoutingSnapshot(7, endpoint, rules)

    rules.push('modelscope.cn')

    expect(snapshot.mode === 'proxy' && snapshot.bypassRules).toEqual(['huggingface.co'])
    expect(snapshot.mode === 'proxy' && snapshot.endpoint).not.toBe(endpoint)
  })

  it('returns a direct snapshot when no proxy endpoint is applied', () => {
    expect(createProxyRoutingSnapshot(3, null, ['huggingface.co'])).toEqual({
      version: 3,
      mode: 'direct'
    })
  })
})
