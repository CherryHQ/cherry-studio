import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ensureInternalGateway: vi.fn(),
  getInternalGatewayOrigin: vi.fn<() => string | undefined>(),
  getCurrentConfig: vi.fn()
}))

vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'ApiGatewayService') {
        return {
          ensureInternalGateway: mocks.ensureInternalGateway,
          getInternalGatewayOrigin: mocks.getInternalGatewayOrigin,
          getAgentSessionUsageHeaders: (sessionId: string) => ({ 'x-cherry-agent-session-id': sessionId }),
          getCurrentConfig: mocks.getCurrentConfig
        }
      }
      throw new Error(`unexpected service ${name}`)
    }
  }
}))

import { gatewayCredentialsFingerprint, resolveApiGatewayRuntime } from '../agentApiGateway'

describe('gatewayCredentialsFingerprint', () => {
  beforeEach(() => {
    mocks.getInternalGatewayOrigin.mockReturnValue('http://127.0.0.1:40001')
  })

  it('changes when the internal listener restarts on another port', () => {
    const before = gatewayCredentialsFingerprint()
    mocks.getInternalGatewayOrigin.mockReturnValue('http://127.0.0.1:40002')
    expect(gatewayCredentialsFingerprint()).not.toBe(before)
  })

  it('does not depend on the user-facing gateway configuration', () => {
    const before = gatewayCredentialsFingerprint()
    mocks.getCurrentConfig.mockReturnValue({ enabled: false, host: '0.0.0.0', port: 1, apiKey: 'rotated' })
    expect(gatewayCredentialsFingerprint()).toBe(before)
  })
})

describe('resolveApiGatewayRuntime', () => {
  it('routes the Agent session through the internal listener with the Agent key', async () => {
    mocks.ensureInternalGateway.mockResolvedValue({ baseUrl: 'http://127.0.0.1:40001', apiKey: 'agent-key' })

    await expect(resolveApiGatewayRuntime('session-1')).resolves.toEqual({
      baseUrl: 'http://127.0.0.1:40001',
      apiKey: 'agent-key',
      usageHeaders: { 'x-cherry-agent-session-id': 'session-1' }
    })
    expect(mocks.ensureInternalGateway).toHaveBeenCalledOnce()
    expect(mocks.getCurrentConfig).not.toHaveBeenCalled()
  })
})
