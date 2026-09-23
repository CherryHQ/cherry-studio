import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveApiGatewayRuntime } from '@main/ai/runtime/agentApiGateway'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

const mocks = vi.hoisted(() => ({
  getGatewayConfig: vi.fn(),
  usesDshGateway: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const result = mockApplicationFactory()
  const get = result.application.getContainer().get.bind(result.application.getContainer())
  result.application.get.mockImplementation((name: string) => {
    if (name === 'ApiGatewayService')
      return {
        getCurrentConfig: mocks.getGatewayConfig,
        isRunning: () => true,
        ensureValidApiKey: async () => 'gateway-key',
        getAgentSessionUsageHeaders: () => ({}),
        getInternalRequestToken: () => 'internal-token'
      }
    return get(name)
  })
  return result
})

vi.mock('../modelInjection', () => ({ usesDshGateway: mocks.usesDshGateway }))

const { buildDshProxyEnvironment, dshGatewayBypassRule } = await import('../dshProxyEnvironment')

const PROXY_ENV = {
  HTTP_PROXY: 'http://proxy.corp.example:8080',
  HTTPS_PROXY: 'http://proxy.corp.example:8080'
}

const provider = { id: 'deepseek' } as unknown as Provider
const model = { id: 'deepseek::deepseek-chat' } as unknown as Model

beforeEach(() => {
  mocks.usesDshGateway.mockReset().mockReturnValue(false)
  mocks.getGatewayConfig.mockReset().mockReturnValue({ enabled: true, host: '127.0.0.1', port: 23333 })
})

describe('dshGatewayBypassRule', () => {
  it('returns undefined for direct provider routes', () => {
    expect(dshGatewayBypassRule(provider, model)).toBeUndefined()
  })

  it.each([
    ['', 0, 'http://127.0.0.1:23333', '127.0.0.1'],
    ['127.0.0.2', 24444, 'http://127.0.0.2:24444', '127.0.0.2'],
    ['0.0.0.0', 24444, 'http://127.0.0.1:24444', '127.0.0.1'],
    ['::', 24444, 'http://[::1]:24444', '[::1]'],
    ['::2', 24444, 'http://[::2]:24444', '[::2]'],
    ['gateway.local', 24444, 'http://gateway.local:24444', 'gateway.local']
  ])('keeps the gateway route and proxy bypass aligned for %s:%i', async (host, port, origin, hostname) => {
    mocks.usesDshGateway.mockReturnValue(true)
    mocks.getGatewayConfig.mockReturnValue({ enabled: true, host, port })

    expect((await resolveApiGatewayRuntime('session-1')).baseUrl).toBe(origin)
    expect(dshGatewayBypassRule(provider, model)).toBe(hostname)
    expect(buildDshProxyEnvironment(provider, model, PROXY_ENV).NO_PROXY?.split(',')).toContain(hostname)
  })
})

describe('buildDshProxyEnvironment', () => {
  it('adds a non-default gateway host to the bypass list', () => {
    mocks.usesDshGateway.mockReturnValue(true)
    mocks.getGatewayConfig.mockReturnValue({ enabled: true, host: '127.0.0.2', port: 23333 })
    const env = buildDshProxyEnvironment(provider, model, { ...PROXY_ENV })
    expect(String(env.NO_PROXY).split(',')).toContain('127.0.0.2')
    expect(String(env.NO_PROXY).split(',')).toContain('127.0.0.1')
  })

  it('never bypasses an external provider host on direct routes', () => {
    const env = buildDshProxyEnvironment(provider, model, { ...PROXY_ENV })
    expect(env.HTTP_PROXY).toBe('http://proxy.corp.example:8080')
    expect(String(env.NO_PROXY ?? '')).not.toContain('deepseek')
  })

  it('returns an empty env when no proxy is configured', () => {
    mocks.usesDshGateway.mockReturnValue(true)
    expect(buildDshProxyEnvironment(provider, model, {})).toEqual({})
  })
})
