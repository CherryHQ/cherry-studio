import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { net, session } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { NetworkEndpoint } from '../types'

const probes = vi.hoisted(() => ({ resolveHost: vi.fn(), tlsHandshake: vi.fn(), httpReach: vi.fn() }))
const proxyService = vi.hoisted(() => ({ getAppliedSnapshot: vi.fn() }))
vi.mock('../probes', () => probes)
vi.mock('../endpoints', () => ({ builtinEndpoints: () => [] }))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({ ProxyService: proxyService } as never)
})

const { NetworkService } = await import('../NetworkService')

const ok = (data?: unknown) => ({ status: 'ok', durationMs: 1, data })
const failed = (kind: string, code: string) => ({ status: 'failed', durationMs: 1, kind, code })
const resolveProxy = () => vi.mocked(session.defaultSession).resolveProxy as unknown as ReturnType<typeof vi.fn>
const endpoint: NetworkEndpoint = { id: 'update', url: 'https://releases.cherry-ai.com/release-history.json' }
const signal = new AbortController().signal
const snapshot = (over: Record<string, unknown> = {}) => ({
  mode: 'none',
  hasConfiguredUrl: false,
  systemProxyReadFailed: false,
  converged: true,
  ...over
})

beforeEach(() => {
  vi.clearAllMocks()
  BaseService.resetInstances()
  MockMainCacheServiceUtils.resetMocks()
  ;(session.defaultSession as { resolveProxy?: unknown }).resolveProxy = vi.fn(async () => 'DIRECT')
  ;(net as { isOnline?: unknown }).isOnline = vi.fn(() => true)
  proxyService.getAppliedSnapshot.mockResolvedValue(snapshot())
  probes.resolveHost.mockResolvedValue(ok({ addresses: ['1.2.3.4'] }))
  probes.tlsHandshake.mockResolvedValue(ok({ issuer: 'R3', validTo: '2027' }))
  probes.httpReach.mockResolvedValue(ok({ status: 200 }))
})

describe('NetworkService.diagnoseEndpoint', () => {
  it('runs all four layers directly and reports reachable', async () => {
    const result = await new NetworkService().diagnoseEndpoint(endpoint, signal)
    expect(result).toMatchObject({
      host: 'releases.cherry-ai.com',
      verdict: 'reachable',
      proxy: { effective: 'DIRECT' }
    })
    expect(probes.resolveHost).toHaveBeenCalledWith('releases.cherry-ai.com', signal)
    expect(probes.tlsHandshake).toHaveBeenCalledWith('releases.cherry-ai.com', 443, signal)
  })

  it('behind a proxy resolves the proxy host and skips the direct TLS handshake', async () => {
    resolveProxy().mockResolvedValue('PROXY corp-proxy.local:8080; DIRECT')
    const result = await new NetworkService().diagnoseEndpoint(endpoint, signal)
    expect(probes.resolveHost).toHaveBeenCalledWith('corp-proxy.local', signal)
    expect(probes.tlsHandshake).not.toHaveBeenCalled()
    expect(result.tls).toMatchObject({ status: 'skipped', skippedBecause: 'proxy_in_use' })
    expect(result.verdict).toBe('reachable')
  })

  it('resolves a bracketed IPv6 proxy literal as the bare address', async () => {
    resolveProxy().mockResolvedValue('PROXY [::1]:8080')
    await new NetworkService().diagnoseEndpoint(endpoint, signal)
    expect(probes.resolveHost).toHaveBeenCalledWith('::1', signal)
  })

  it('skips TLS and HTTP when DNS fails and reports unreachable', async () => {
    probes.resolveHost.mockResolvedValue(failed('dns', 'ENOTFOUND'))
    const result = await new NetworkService().diagnoseEndpoint(endpoint, signal)
    expect(probes.httpReach).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      tls: { skippedBecause: 'dns_failed' },
      http: { skippedBecause: 'dns_failed' },
      verdict: 'unreachable'
    })
  })

  it('reports reachable_untrusted_tls only for a rejected certificate on a direct connection', async () => {
    const service = new NetworkService()
    probes.tlsHandshake.mockResolvedValue(failed('tls_cert', 'ERR_CERT_AUTHORITY_INVALID'))
    expect((await service.diagnoseEndpoint(endpoint, signal)).verdict).toBe('reachable_untrusted_tls')
    probes.tlsHandshake.mockResolvedValue(failed('refused', 'ECONNREFUSED'))
    expect((await service.diagnoseEndpoint(endpoint, signal)).verdict).toBe('reachable')
  })
})

describe('NetworkService.effectiveProxy', () => {
  it('flags a custom mode without a URL', async () => {
    proxyService.getAppliedSnapshot.mockResolvedValue(snapshot({ mode: 'custom' }))
    expect(await new NetworkService().effectiveProxy(endpoint.url)).toMatchObject({
      configuredMode: 'custom',
      mismatch: 'custom_without_url'
    })
  })

  it('flags a failed OS proxy read in system mode', async () => {
    proxyService.getAppliedSnapshot.mockResolvedValue(snapshot({ mode: 'system', systemProxyReadFailed: true }))
    expect(await new NetworkService().effectiveProxy(endpoint.url)).toMatchObject({ mismatch: 'system_read_failed' })
  })

  it('flags a configured proxy that never got applied, even though traffic goes DIRECT', async () => {
    proxyService.getAppliedSnapshot.mockResolvedValue(
      snapshot({ mode: 'custom', hasConfiguredUrl: true, converged: false, lastError: 'Invalid URL' })
    )
    expect(await new NetworkService().effectiveProxy(endpoint.url)).toMatchObject({
      effective: 'DIRECT',
      mismatch: 'apply_failed'
    })
  })
})

describe('NetworkService online state', () => {
  it('reads the current state on every call and publishes the transition', () => {
    const isOnline = vi.mocked(net.isOnline)
    const service = new NetworkService()
    expect(service.isOnline()).toBe(true)
    expect(application.get('CacheService').getShared('network.online')).toBe(true)
    isOnline.mockReturnValue(false)
    expect(service.isOnline()).toBe(false)
    expect(application.get('CacheService').getShared('network.online')).toBe(false)
  })
})
