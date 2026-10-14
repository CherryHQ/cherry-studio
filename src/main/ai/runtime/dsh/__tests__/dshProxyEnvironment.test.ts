import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveApiGatewayRuntime } from '@main/ai/runtime/agentApiGateway'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

const mocks = vi.hoisted(() => ({
  internalOrigin: undefined as string | undefined,
  usesDshGateway: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const result = mockApplicationFactory()
  const get = result.application.getContainer().get.bind(result.application.getContainer())
  result.application.get.mockImplementation((name: string) => {
    if (name === 'ApiGatewayService')
      return {
        ensureInternalGateway: async () => {
          mocks.internalOrigin ??= 'http://127.0.0.1:40001'
          return { baseUrl: mocks.internalOrigin, apiKey: 'agent-key' }
        },
        getInternalGatewayOrigin: () => mocks.internalOrigin,
        getAgentSessionUsageHeaders: () => ({})
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
  mocks.internalOrigin = undefined
})

describe('dshGatewayBypassRule', () => {
  it('returns undefined for direct provider routes', () => {
    expect(dshGatewayBypassRule(provider, model)).toBeUndefined()
  })

  it('keeps the gateway route and proxy bypass aligned on the internal listener', async () => {
    mocks.usesDshGateway.mockReturnValue(true)
    expect(dshGatewayBypassRule(provider, model)).toBeUndefined()

    const { baseUrl } = await resolveApiGatewayRuntime('session-1')
    const hostname = new URL(baseUrl).hostname
    expect(dshGatewayBypassRule(provider, model)).toBe(hostname)
    expect(buildDshProxyEnvironment(provider, model, PROXY_ENV).NO_PROXY?.split(',')).toContain(hostname)
  })
})

describe('buildDshProxyEnvironment', () => {
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
