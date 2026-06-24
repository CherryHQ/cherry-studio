import { beforeEach, describe, expect, it, vi } from 'vitest'

const CACHE_KEY = 'region.egressCountry'

// Hoisted shared state so the vi.mock factories can close over it: the proxy
// key is mutated per-test to exercise cache invalidation, and net.fetch is the
// single geolocation transport under test.
const { netFetchMock, proxyState } = vi.hoisted(() => ({
  netFetchMock: vi.fn(),
  proxyState: { appliedProxyKey: 'direct||' as string | null }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() })
  }
}))

vi.mock('electron', () => ({
  net: { fetch: netFetchMock }
}))

// Unified application mock provides a real Map-backed CacheService; ProxyManager
// is not a default service, so wrap `get` to return our controllable stub.
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const result = mockApplicationFactory()
  const originalGet = result.application.get.getMockImplementation()!
  result.application.get.mockImplementation((name: string) => {
    if (name === 'ProxyManager') {
      return {
        get appliedProxyKey() {
          return proxyState.appliedProxyKey
        }
      }
    }
    return originalGet(name)
  })
  return result
})

import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'

import { regionService } from '../RegionService'

const fetchResponse = (body: unknown) => ({ json: async () => body })

describe('RegionService', () => {
  beforeEach(() => {
    MockMainCacheServiceUtils.resetMocks()
    netFetchMock.mockReset()
    proxyState.appliedProxyKey = 'direct||'
  })

  it('fetches the egress country and caches it for subsequent calls', async () => {
    netFetchMock.mockResolvedValue(fetchResponse({ country_code: 'US' }))

    await expect(regionService.getCountry()).resolves.toBe('US')
    // Second call is served from cache — no second network request.
    await expect(regionService.getCountry()).resolves.toBe('US')
    expect(netFetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports isInChina based on the detected country', async () => {
    netFetchMock.mockResolvedValue(fetchResponse({ country_code: 'cn' }))
    await expect(regionService.isInChina()).resolves.toBe(true)

    MockMainCacheServiceUtils.resetMocks()
    netFetchMock.mockResolvedValue(fetchResponse({ country_code: 'JP' }))
    await expect(regionService.isInChina()).resolves.toBe(false)
  })

  it('defaults to CN when the request fails', async () => {
    netFetchMock.mockRejectedValue(new Error('network down'))
    await expect(regionService.getCountry()).resolves.toBe('CN')
  })

  it('defaults to CN when the response has no country_code', async () => {
    netFetchMock.mockResolvedValue(fetchResponse({}))
    await expect(regionService.getCountry()).resolves.toBe('CN')
  })

  it('re-detects when the applied proxy key changes (egress may have moved)', async () => {
    proxyState.appliedProxyKey = 'fixed_servers|http://proxy-us|'
    netFetchMock.mockResolvedValue(fetchResponse({ country_code: 'US' }))
    await expect(regionService.getCountry()).resolves.toBe('US')

    // Proxy changed → egress IP may differ → cached value is no longer trusted.
    proxyState.appliedProxyKey = 'direct||'
    netFetchMock.mockResolvedValue(fetchResponse({ country_code: 'CN' }))
    await expect(regionService.getCountry()).resolves.toBe('CN')
    expect(netFetchMock).toHaveBeenCalledTimes(2)
  })

  it('re-detects after the cached entry expires (TTL backstop)', async () => {
    netFetchMock.mockResolvedValue(fetchResponse({ country_code: 'US' }))
    await expect(regionService.getCountry()).resolves.toBe('US')

    MockMainCacheServiceUtils.simulateCacheExpiration(CACHE_KEY)
    netFetchMock.mockResolvedValue(fetchResponse({ country_code: 'CN' }))
    await expect(regionService.getCountry()).resolves.toBe('CN')
    expect(netFetchMock).toHaveBeenCalledTimes(2)
  })

  it('single-flights concurrent detections into one request', async () => {
    let resolveFetch: (value: unknown) => void = () => {}
    netFetchMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve
      })
    )

    const first = regionService.getCountry()
    const second = regionService.getCountry()
    resolveFetch(fetchResponse({ country_code: 'JP' }))

    await expect(Promise.all([first, second])).resolves.toEqual(['JP', 'JP'])
    expect(netFetchMock).toHaveBeenCalledTimes(1)
  })
})
