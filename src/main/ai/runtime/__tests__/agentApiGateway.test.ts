import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentConfig: vi.fn(),
  isRunning: vi.fn(),
  ensureRunning: vi.fn(async () => undefined),
  ensureValidApiKey: vi.fn(async () => 'gw-key-1'),
  getAgentSessionUsageHeaders: vi.fn(() => ({ 'x-session': 'session-1' })),
  getInternalRequestToken: vi.fn(() => 'internal-token')
}))

vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'ApiGatewayService') {
        return {
          getCurrentConfig: mocks.getCurrentConfig,
          isRunning: mocks.isRunning,
          ensureRunning: mocks.ensureRunning,
          ensureValidApiKey: mocks.ensureValidApiKey,
          getAgentSessionUsageHeaders: mocks.getAgentSessionUsageHeaders,
          getInternalRequestToken: mocks.getInternalRequestToken
        }
      }
      throw new Error(`unexpected service ${name}`)
    }
  }
}))

import { gatewayCredentialsFingerprint, resolveApiGatewayRuntime } from '../agentApiGateway'

describe('gatewayCredentialsFingerprint', () => {
  beforeEach(() => {
    mocks.getCurrentConfig.mockReturnValue({ enabled: true, host: '127.0.0.1', port: 23333, apiKey: 'gw-key-1' })
    mocks.isRunning.mockReturnValue(true)
    mocks.ensureRunning.mockClear()
  })

  it('uses the port selected while the gateway was converging', async () => {
    mocks.getCurrentConfig
      .mockReturnValueOnce({ enabled: true, host: '127.0.0.1', port: 23333, apiKey: 'gw-key-1' })
      .mockReturnValueOnce({ enabled: true, host: '127.0.0.1', port: 24444, apiKey: 'gw-key-1' })

    await expect(resolveApiGatewayRuntime('session-1')).resolves.toMatchObject({
      baseUrl: 'http://127.0.0.1:24444'
    })
  })

  it('changes when the gateway key rotates', () => {
    const before = gatewayCredentialsFingerprint()
    mocks.getCurrentConfig.mockReturnValue({ enabled: true, host: '127.0.0.1', port: 23333, apiKey: 'gw-key-2' })
    expect(gatewayCredentialsFingerprint()).not.toBe(before)
  })

  it('changes when the gateway address or enabled/running state changes', () => {
    const before = gatewayCredentialsFingerprint()
    mocks.getCurrentConfig.mockReturnValue({ enabled: true, host: '127.0.0.2', port: 24444, apiKey: 'gw-key-1' })
    expect(gatewayCredentialsFingerprint()).not.toBe(before)

    mocks.getCurrentConfig.mockReturnValue({ enabled: true, host: '127.0.0.1', port: 23333, apiKey: 'gw-key-1' })
    mocks.isRunning.mockReturnValue(false)
    expect(gatewayCredentialsFingerprint()).not.toBe(before)
  })

  it('is stable across reads with unchanged state and never leaks the key', () => {
    const first = gatewayCredentialsFingerprint()
    expect(gatewayCredentialsFingerprint()).toBe(first)
    expect(first).not.toContain('gw-key-1')
  })
})
