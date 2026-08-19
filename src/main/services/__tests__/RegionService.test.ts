import { EventEmitter } from 'node:events'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const CACHE_KEY = 'region.egressCountry'

// Hoisted shared state so the vi.mock factories can close over it: the proxy
// key is mutated per-test to exercise cache invalidation, and net.request is
// the single geolocation transport under test.
const { netRequestMock, proxyState } = vi.hoisted(() => ({
  netRequestMock: vi.fn(),
  proxyState: { appliedProxyKey: 'direct||' as string | null }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() })
  }
}))

vi.mock('electron', () => ({
  net: { request: netRequestMock }
}))

// Unified application mock provides a real Map-backed CacheService; ProxyService
// is not a default service, so wrap `get` to return our controllable stub.
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const result = mockApplicationFactory()
  const originalGet = result.application.get.getMockImplementation()!
  result.application.get.mockImplementation((name: string) => {
    if (name === 'ProxyService') {
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

type ResponseOptions = {
  headers?: Record<string, string[]>
  statusCode?: number
}

function createRequest(body: unknown, options: ResponseOptions = {}) {
  const request = Object.assign(new EventEmitter(), { abort: vi.fn(), end: vi.fn() })
  const response = Object.assign(new EventEmitter(), {
    headers: options.headers ?? {},
    statusCode: options.statusCode ?? 200
  })

  request.end.mockImplementation(() => {
    queueMicrotask(() => {
      request.emit('response', response)
      if (response.statusCode >= 200 && response.statusCode < 300) {
        response.emit('data', Buffer.from(JSON.stringify(body)))
        response.emit('end')
      }
    })
  })

  return request
}

function mockResponse(body: unknown, options: ResponseOptions = {}) {
  netRequestMock.mockImplementation(() => createRequest(body, options))
}

function mockResponseOnce(body: unknown, options: ResponseOptions = {}) {
  netRequestMock.mockImplementationOnce(() => createRequest(body, options))
}

function mockFailureOnce(error: Error) {
  netRequestMock.mockImplementationOnce(() => {
    const request = Object.assign(new EventEmitter(), { abort: vi.fn(), end: vi.fn() })
    request.end.mockImplementation(() => queueMicrotask(() => request.emit('error', error)))
    return request
  })
}

describe('RegionService', () => {
  beforeEach(() => {
    MockMainCacheServiceUtils.resetMocks()
    netRequestMock.mockReset()
    proxyState.appliedProxyKey = 'direct||'
  })

  it('fetches the egress country and caches it for subsequent calls', async () => {
    mockResponse({ country_code: 'US' })

    await expect(regionService.getCountry()).resolves.toBe('US')
    // Second call is served from cache — no second network request.
    await expect(regionService.getCountry()).resolves.toBe('US')
    expect(netRequestMock).toHaveBeenCalledTimes(1)
  })

  it('reports isInChina based on the detected country', async () => {
    mockResponse({ country_code: 'cn' })
    await expect(regionService.isInChina()).resolves.toBe(true)

    MockMainCacheServiceUtils.resetMocks()
    mockResponse({ country_code: 'JP' })
    await expect(regionService.isInChina()).resolves.toBe(false)
  })

  it('does not cache the CN fallback when the request fails', async () => {
    mockFailureOnce(new Error('network down'))
    mockResponseOnce({ country_code: 'US' })

    await expect(regionService.getCountry()).resolves.toBe('CN')
    await expect(regionService.getCountry()).resolves.toBe('US')
    expect(netRequestMock).toHaveBeenCalledTimes(2)
  })

  it('does not cache the CN fallback when the response has no country_code', async () => {
    mockResponseOnce({})
    mockResponseOnce({ country_code: 'US' })

    await expect(regionService.getCountry()).resolves.toBe('CN')
    await expect(regionService.getCountry()).resolves.toBe('US')
    expect(netRequestMock).toHaveBeenCalledTimes(2)
  })

  it('treats HTTP non-ok responses as retryable failures', async () => {
    mockResponseOnce({ country_code: 'US' }, { statusCode: 500 })
    mockResponseOnce({ country_code: 'JP' })

    await expect(regionService.getCountry()).resolves.toBe('CN')
    await expect(regionService.getCountry()).resolves.toBe('JP')
    expect(netRequestMock).toHaveBeenCalledTimes(2)
  })

  it('handles response stream errors after receiving a non-ok status', async () => {
    const request = Object.assign(new EventEmitter(), { abort: vi.fn(), end: vi.fn() })
    const response = Object.assign(new EventEmitter(), { headers: {}, statusCode: 502 })
    request.end.mockImplementation(() => queueMicrotask(() => request.emit('response', response)))
    netRequestMock.mockReturnValue(request)

    await expect(regionService.getCountry()).resolves.toBe('CN')
    expect(request.abort).toHaveBeenCalledOnce()
    expect(() => response.emit('error', new Error('response interrupted'))).not.toThrow()
  })

  it('re-detects when the applied proxy key changes (egress may have moved)', async () => {
    proxyState.appliedProxyKey = 'fixed_servers|http://proxy-us|'
    mockResponse({ country_code: 'US' })
    await expect(regionService.getCountry()).resolves.toBe('US')

    // Proxy changed → egress IP may differ → cached value is no longer trusted.
    proxyState.appliedProxyKey = 'direct||'
    mockResponse({ country_code: 'CN' })
    await expect(regionService.getCountry()).resolves.toBe('CN')
    expect(netRequestMock).toHaveBeenCalledTimes(2)
  })

  it('re-detects after the cached entry expires (TTL backstop)', async () => {
    mockResponse({ country_code: 'US' })
    await expect(regionService.getCountry()).resolves.toBe('US')

    MockMainCacheServiceUtils.simulateCacheExpiration(CACHE_KEY)
    mockResponse({ country_code: 'CN' })
    await expect(regionService.getCountry()).resolves.toBe('CN')
    expect(netRequestMock).toHaveBeenCalledTimes(2)
  })

  it('ignores non-ByteString response headers while reading the JSON body', async () => {
    mockResponse({ country_code: 'US' }, { headers: { 'x-proxy-message': ['机器已连接'] } })

    await expect(regionService.getCountry()).resolves.toBe('US')
  })

  it('single-flights concurrent detections into one request', async () => {
    const request = createRequest({ country_code: 'JP' })
    netRequestMock.mockReturnValue(request)

    const first = regionService.getCountry()
    const second = regionService.getCountry()

    await expect(Promise.all([first, second])).resolves.toEqual(['JP', 'JP'])
    expect(netRequestMock).toHaveBeenCalledTimes(1)
  })
})
