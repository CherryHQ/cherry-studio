import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  applyNodeProxyFromEnvironment,
  buildNodeProxyEnvironment,
  getNodeProxyConfigFromEnvironment,
  getProxyEnvironment,
  getProxyProtocol,
  ProxyBypassRuleMatcher
} from '../proxy/nodeProxy'
import { isProxyReachable } from '../ProxyManager'

// Mock lifecycle to allow direct instantiation
vi.mock('@main/core/lifecycle', () => {
  class MockBaseService {
    _disposables: { dispose: () => void }[] = []
    registerDisposable(disposableOrFn: any) {
      const disposable = typeof disposableOrFn === 'function' ? { dispose: disposableOrFn } : disposableOrFn
      this._disposables.push(disposable)
      return disposable
    }
    registerInterval() {
      return { dispose: () => {} }
    }
  }

  return {
    BaseService: MockBaseService,
    Injectable: () => (target: unknown) => target,
    ServicePhase: () => (target: unknown) => target,
    Phase: { Background: 'background', WhenReady: 'whenReady', BeforeReady: 'beforeReady' }
  }
})

describe('ProxyManager - bypass evaluation', () => {
  let matcher: ProxyBypassRuleMatcher

  const updateByPassRules = (rules: string[]) => matcher.updateByPassRules(rules)
  const isByPass = (url: string) => matcher.isByPass(url)

  beforeEach(() => {
    matcher = new ProxyBypassRuleMatcher()
  })

  it('matches simple hostname patterns', () => {
    updateByPassRules(['foobar.com'])
    expect(isByPass('http://foobar.com')).toBe(true)
    expect(isByPass('http://www.foobar.com')).toBe(false)

    updateByPassRules(['*.foobar.com'])
    expect(isByPass('http://api.foobar.com')).toBe(true)
    expect(isByPass('http://foobar.com')).toBe(true)
    expect(isByPass('http://foobar.org')).toBe(false)

    updateByPassRules(['*foobar.com'])
    expect(isByPass('http://devfoobar.com')).toBe(true)
    expect(isByPass('http://foobar.com')).toBe(true)
    expect(isByPass('http://foobar.company')).toBe(false)
  })

  it('matches hostname patterns with scheme and port qualifiers', () => {
    updateByPassRules(['https://secure.example.com'])
    expect(isByPass('https://secure.example.com')).toBe(true)
    expect(isByPass('https://secure.example.com:443/home')).toBe(true)
    expect(isByPass('http://secure.example.com')).toBe(false)

    updateByPassRules(['https://secure.example.com:8443'])
    expect(isByPass('https://secure.example.com:8443')).toBe(true)
    expect(isByPass('https://secure.example.com')).toBe(false)
    expect(isByPass('https://secure.example.com:443')).toBe(false)

    updateByPassRules(['https://x.*.y.com:99'])
    expect(isByPass('https://x.api.y.com:99')).toBe(true)
    expect(isByPass('https://x.api.y.com')).toBe(false)
    expect(isByPass('http://x.api.y.com:99')).toBe(false)
  })

  it('matches domain suffix patterns with leading dot', () => {
    updateByPassRules(['.example.com'])
    expect(isByPass('https://example.com')).toBe(true)
    expect(isByPass('https://api.example.com')).toBe(true)
    expect(isByPass('https://deep.api.example.com')).toBe(true)
    expect(isByPass('https://example.org')).toBe(false)

    updateByPassRules(['.com'])
    expect(isByPass('https://anything.com')).toBe(true)
    expect(isByPass('https://example.org')).toBe(false)

    updateByPassRules(['http://.google.com'])
    expect(isByPass('http://maps.google.com')).toBe(true)
    expect(isByPass('https://maps.google.com')).toBe(false)
  })

  it('matches IP literals, CIDR ranges, and wildcard IPs', () => {
    updateByPassRules(['127.0.0.1', '[::1]', '192.168.1.0/24', 'fefe:13::abc/33', '192.168.*.*'])

    expect(isByPass('http://127.0.0.1')).toBe(true)
    expect(isByPass('http://[::1]')).toBe(true)
    expect(isByPass('http://192.168.1.55')).toBe(true)
    expect(isByPass('http://192.168.200.200')).toBe(true)
    expect(isByPass('http://192.169.1.1')).toBe(false)
    expect(isByPass('http://[fefe:13::abc]')).toBe(true)
  })

  it('matches CIDR ranges specified with IPv6 prefix lengths', () => {
    updateByPassRules(['[2001:db8::1]', '2001:db8::/32'])

    expect(isByPass('http://[2001:db8::1]')).toBe(true)
    expect(isByPass('http://[2001:db8:0:0:0:0:0:ffff]')).toBe(true)
    expect(isByPass('http://[2001:db9::1]')).toBe(false)
  })

  it('matches local addresses when <local> keyword is provided', () => {
    updateByPassRules(['<local>'])

    expect(isByPass('http://localhost')).toBe(true)
    expect(isByPass('http://127.0.0.1')).toBe(true)
    expect(isByPass('http://[::1]')).toBe(true)
    expect(isByPass('http://dev.localdomain')).toBe(false)
  })

  it('exports standard HTTP proxy env vars for http proxies', () => {
    const env = buildNodeProxyEnvironment({
      proxyRules: 'http://127.0.0.1:7890',
      proxyBypassRules: 'localhost,*.local'
    })

    expect(env.HTTP_PROXY).toBe('http://127.0.0.1:7890')
    expect(env.HTTPS_PROXY).toBe('http://127.0.0.1:7890')
    expect(env.http_proxy).toBe('http://127.0.0.1:7890')
    expect(env.https_proxy).toBe('http://127.0.0.1:7890')
    expect(env.ALL_PROXY).toBe('http://127.0.0.1:7890')
    expect(env.NO_PROXY).toBe('localhost,*.local')
    expect(env.no_proxy).toBe('localhost,*.local')
  })

  it('exports only socks-compatible env vars for socks proxies', () => {
    const env = buildNodeProxyEnvironment({
      proxyRules: 'socks5://127.0.0.1:6153',
      proxyBypassRules: 'localhost,*.local'
    })

    expect(env.SOCKS_PROXY).toBe('socks5://127.0.0.1:6153')
    expect(env.socks_proxy).toBe('socks5://127.0.0.1:6153')
    expect(env.ALL_PROXY).toBe('socks5://127.0.0.1:6153')
    expect(env.all_proxy).toBe('socks5://127.0.0.1:6153')
    expect(env.HTTP_PROXY).toBeUndefined()
    expect(env.HTTPS_PROXY).toBeUndefined()
    expect(env.http_proxy).toBeUndefined()
    expect(env.https_proxy).toBeUndefined()
    expect(env.NO_PROXY).toBe('localhost,*.local')
    expect(env.no_proxy).toBe('localhost,*.local')
  })

  it('returns empty env when proxy rules are missing', () => {
    expect(buildNodeProxyEnvironment({})).toEqual({})
  })

  it('omits no_proxy env vars when bypass rules are missing', () => {
    const env = buildNodeProxyEnvironment({
      proxyRules: 'http://127.0.0.1:7890'
    })

    expect(env.NO_PROXY).toBeUndefined()
    expect(env.no_proxy).toBeUndefined()
  })

  it('returns false when bootstrap env has no proxy rules', () => {
    expect(applyNodeProxyFromEnvironment({})).toBe(false)
  })

  it('returns null for invalid proxy urls when detecting protocol', () => {
    expect(getProxyProtocol('127.0.0.1:7890')).toBe(null)
  })

  it('extracts only proxy-related env vars', () => {
    expect(
      getProxyEnvironment({
        HTTP_PROXY: 'http://127.0.0.1:7890',
        NO_PROXY: 'localhost',
        PATH: '/usr/bin'
      })
    ).toEqual({
      HTTP_PROXY: 'http://127.0.0.1:7890',
      NO_PROXY: 'localhost'
    })
  })

  it('derives proxy config from standard proxy env vars', () => {
    expect(
      getNodeProxyConfigFromEnvironment({
        ALL_PROXY: 'socks5://127.0.0.1:6153',
        NO_PROXY: 'localhost'
      })
    ).toEqual({
      proxyRules: 'socks5://127.0.0.1:6153',
      proxyBypassRules: 'localhost'
    })
  })

  it('exports standard HTTP proxy env vars for http proxies', () => {
    const env = buildNodeProxyEnvironment({
      proxyRules: 'http://127.0.0.1:7890',
      proxyBypassRules: 'localhost,*.local'
    })

    expect(env.HTTP_PROXY).toBe('http://127.0.0.1:7890')
    expect(env.HTTPS_PROXY).toBe('http://127.0.0.1:7890')
    expect(env.http_proxy).toBe('http://127.0.0.1:7890')
    expect(env.https_proxy).toBe('http://127.0.0.1:7890')
    expect(env.ALL_PROXY).toBe('http://127.0.0.1:7890')
    expect(env.NO_PROXY).toBe('localhost,*.local')
    expect(env.no_proxy).toBe('localhost,*.local')
  })

  it('exports only socks-compatible env vars for socks proxies', () => {
    const env = buildNodeProxyEnvironment({
      proxyRules: 'socks5://127.0.0.1:6153',
      proxyBypassRules: 'localhost,*.local'
    })

    expect(env.SOCKS_PROXY).toBe('socks5://127.0.0.1:6153')
    expect(env.socks_proxy).toBe('socks5://127.0.0.1:6153')
    expect(env.ALL_PROXY).toBe('socks5://127.0.0.1:6153')
    expect(env.all_proxy).toBe('socks5://127.0.0.1:6153')
    expect(env.HTTP_PROXY).toBeUndefined()
    expect(env.HTTPS_PROXY).toBeUndefined()
    expect(env.http_proxy).toBeUndefined()
    expect(env.https_proxy).toBeUndefined()
    expect(env.NO_PROXY).toBe('localhost,*.local')
    expect(env.no_proxy).toBe('localhost,*.local')
  })

  it('returns empty env when proxy rules are missing', () => {
    expect(buildNodeProxyEnvironment({})).toEqual({})
  })

  it('omits no_proxy env vars when bypass rules are missing', () => {
    const env = buildNodeProxyEnvironment({
      proxyRules: 'http://127.0.0.1:7890'
    })

    expect(env.NO_PROXY).toBeUndefined()
    expect(env.no_proxy).toBeUndefined()
  })

  it('returns false when bootstrap env has no proxy rules', () => {
    expect(applyNodeProxyFromEnvironment({})).toBe(false)
  })

  it('returns null for invalid proxy urls when detecting protocol', () => {
    expect(getProxyProtocol('127.0.0.1:7890')).toBe(null)
  })

  it('extracts only proxy-related env vars', () => {
    expect(
      getProxyEnvironment({
        HTTP_PROXY: 'http://127.0.0.1:7890',
        NO_PROXY: 'localhost',
        PATH: '/usr/bin'
      })
    ).toEqual({
      HTTP_PROXY: 'http://127.0.0.1:7890',
      NO_PROXY: 'localhost'
    })
  })

  it('derives proxy config from standard proxy env vars', () => {
    expect(
      getNodeProxyConfigFromEnvironment({
        ALL_PROXY: 'socks5://127.0.0.1:6153',
        NO_PROXY: 'localhost'
      })
    ).toEqual({
      proxyRules: 'socks5://127.0.0.1:6153',
      proxyBypassRules: 'localhost'
    })
  })
})

describe('isProxyReachable', () => {
  // Black-box: reachable proxy
  it('returns true when proxy is reachable (localhost test server)', async () => {
    const net = await import('net')
    const server = net.createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    const port = address && typeof address === 'object' ? address.port : 0

    const result = await isProxyReachable(`http://127.0.0.1:${port}`)
    expect(result).toBe(true)

    server.close()
  })

  // Black-box: unreachable proxy
  it('returns false when proxy port is not listening', async () => {
    const result = await isProxyReachable('http://127.0.0.1:59999')
    expect(result).toBe(false)
  })

  it('returns false for unreachable host', async () => {
    const result = await isProxyReachable('http://192.0.2.1:8080', 100)
    expect(result).toBe(false)
  })

  // Black-box: URL parsing edge cases
  it('uses default port 80 for http URLs without port', async () => {
    // Use a non-routable test IP to avoid collision with local services
    const result = await isProxyReachable('http://192.0.2.1', 100)
    expect(result).toBe(false)
  })

  it('uses default port 443 for https URLs without port', async () => {
    const result = await isProxyReachable('https://192.0.2.1', 100)
    expect(result).toBe(false)
  })

  it('returns false for invalid URL', async () => {
    const result = await isProxyReachable('not-a-url')
    expect(result).toBe(false)
  })

  it('returns false for empty string', async () => {
    const result = await isProxyReachable('')
    expect(result).toBe(false)
  })

  // White-box: timeout behavior
  it('respects custom timeout', async () => {
    const start = Date.now()
    await isProxyReachable('http://192.0.2.1:8080', 50)
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(200)
  })

  it('uses default 3s timeout when not specified', async () => {
    const start = Date.now()
    await isProxyReachable('http://192.0.2.1:8080')
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(4000)
    expect(elapsed).toBeGreaterThanOrEqual(100)
  })

  // Security: URL with credentials should not leak
  it('handles URLs with credentials without error', async () => {
    const result = await isProxyReachable('http://user:pass@127.0.0.1:59999', 100)
    expect(result).toBe(false)
  })

  // Security: IPv6 addresses
  it('handles IPv6 localhost', async () => {
    const result = await isProxyReachable('http://[::1]:59999', 100)
    expect(result).toBe(false)
  })

  // Performance: should not hang
  it('resolves within reasonable time for dead proxy', async () => {
    const start = Date.now()
    await isProxyReachable('http://127.0.0.1:59998', 100)
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(500)
  })
})
