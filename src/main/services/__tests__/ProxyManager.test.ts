import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock lifecycle to allow direct instantiation
vi.mock('@main/core/lifecycle', () => {
  class MockBaseService {
    _disposables: { dispose: () => void }[] = []
    registerDisposable(disposableOrFn: any) {
      const disposable = typeof disposableOrFn === 'function' ? { dispose: disposableOrFn } : disposableOrFn
      this._disposables.push(disposable)
      return disposable
    }
  }

  return {
    BaseService: MockBaseService,
    Injectable: () => (target: unknown) => target,
    ServicePhase: () => (target: unknown) => target,
    Phase: { Background: 'background', WhenReady: 'whenReady', BeforeReady: 'beforeReady' }
  }
})

// Mock undici (getGlobalDispatcher is needed by constructor)
vi.mock('undici', () => ({
  Dispatcher: class {},
  EnvHttpProxyAgent: vi.fn(),
  getGlobalDispatcher: vi.fn(() => ({})),
  setGlobalDispatcher: vi.fn()
}))

// Mock os-proxy-config
vi.mock('os-proxy-config', () => ({
  getSystemProxy: vi.fn()
}))

// Mock proxy-agent
vi.mock('proxy-agent', () => ({
  ProxyAgent: vi.fn()
}))

// Mock fetch-socks
vi.mock('fetch-socks', () => ({
  socksDispatcher: vi.fn()
}))

import { ProxyManager } from '../ProxyManager'

function createService(): ProxyManager {
  return new ProxyManager()
}

describe('ProxyManager - bypass evaluation', () => {
  let service: ProxyManager

  beforeEach(() => {
    service = createService()
    service.updateByPassRules([])
  })

  it('matches simple hostname patterns', () => {
    service.updateByPassRules(['foobar.com'])
    expect(service.isByPass('http://foobar.com')).toBe(true)
    expect(service.isByPass('http://www.foobar.com')).toBe(false)

    service.updateByPassRules(['*.foobar.com'])
    expect(service.isByPass('http://api.foobar.com')).toBe(true)
    expect(service.isByPass('http://foobar.com')).toBe(true)
    expect(service.isByPass('http://foobar.org')).toBe(false)

    service.updateByPassRules(['*foobar.com'])
    expect(service.isByPass('http://devfoobar.com')).toBe(true)
    expect(service.isByPass('http://foobar.com')).toBe(true)
    expect(service.isByPass('http://foobar.company')).toBe(false)
  })

  it('matches hostname patterns with scheme and port qualifiers', () => {
    service.updateByPassRules(['https://secure.example.com'])
    expect(service.isByPass('https://secure.example.com')).toBe(true)
    expect(service.isByPass('https://secure.example.com:443/home')).toBe(true)
    expect(service.isByPass('http://secure.example.com')).toBe(false)

    service.updateByPassRules(['https://secure.example.com:8443'])
    expect(service.isByPass('https://secure.example.com:8443')).toBe(true)
    expect(service.isByPass('https://secure.example.com')).toBe(false)
    expect(service.isByPass('https://secure.example.com:443')).toBe(false)

    service.updateByPassRules(['https://x.*.y.com:99'])
    expect(service.isByPass('https://x.api.y.com:99')).toBe(true)
    expect(service.isByPass('https://x.api.y.com')).toBe(false)
    expect(service.isByPass('http://x.api.y.com:99')).toBe(false)
  })

  it('matches domain suffix patterns with leading dot', () => {
    service.updateByPassRules(['.example.com'])
    expect(service.isByPass('https://example.com')).toBe(true)
    expect(service.isByPass('https://api.example.com')).toBe(true)
    expect(service.isByPass('https://deep.api.example.com')).toBe(true)
    expect(service.isByPass('https://example.org')).toBe(false)

    service.updateByPassRules(['.com'])
    expect(service.isByPass('https://anything.com')).toBe(true)
    expect(service.isByPass('https://example.org')).toBe(false)

    service.updateByPassRules(['http://.google.com'])
    expect(service.isByPass('http://maps.google.com')).toBe(true)
    expect(service.isByPass('https://maps.google.com')).toBe(false)
  })

  it('matches IP literals, CIDR ranges, and wildcard IPs', () => {
    service.updateByPassRules(['127.0.0.1', '[::1]', '192.168.1.0/24', 'fefe:13::abc/33', '192.168.*.*'])

    expect(service.isByPass('http://127.0.0.1')).toBe(true)
    expect(service.isByPass('http://[::1]')).toBe(true)
    expect(service.isByPass('http://192.168.1.55')).toBe(true)
    expect(service.isByPass('http://192.168.200.200')).toBe(true)
    expect(service.isByPass('http://192.169.1.1')).toBe(false)
    expect(service.isByPass('http://[fefe:13::abc]')).toBe(true)
  })

  it('matches CIDR ranges specified with IPv6 prefix lengths', () => {
    service.updateByPassRules(['[2001:db8::1]', '2001:db8::/32'])

    expect(service.isByPass('http://[2001:db8::1]')).toBe(true)
    expect(service.isByPass('http://[2001:db8:0:0:0:0:0:ffff]')).toBe(true)
    expect(service.isByPass('http://[2001:db9::1]')).toBe(false)
  })

  it('matches local addresses when <local> keyword is provided', () => {
    service.updateByPassRules(['<local>'])

    expect(service.isByPass('http://localhost')).toBe(true)
    expect(service.isByPass('http://127.0.0.1')).toBe(true)
    expect(service.isByPass('http://[::1]')).toBe(true)
    expect(service.isByPass('http://dev.localdomain')).toBe(false)
  })
})
