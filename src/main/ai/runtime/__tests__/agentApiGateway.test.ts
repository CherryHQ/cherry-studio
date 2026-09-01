import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentConfig: vi.fn(),
  isRunning: vi.fn(),
  getPreference: vi.fn()
}))

vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'ApiGatewayService') {
        return { getCurrentConfig: mocks.getCurrentConfig, isRunning: mocks.isRunning }
      }
      if (name === 'PreferenceService') return { get: mocks.getPreference }
      throw new Error(`unexpected service ${name}`)
    }
  }
}))

import { gatewayCredentialsFingerprint } from '../agentApiGateway'

describe('gatewayCredentialsFingerprint', () => {
  beforeEach(() => {
    mocks.getCurrentConfig.mockReturnValue({ enabled: true, host: '127.0.0.1', port: 23333 })
    mocks.isRunning.mockReturnValue(true)
    mocks.getPreference.mockReturnValue('gw-key-1')
  })

  it('changes when the gateway key rotates', () => {
    const before = gatewayCredentialsFingerprint()
    mocks.getPreference.mockReturnValue('gw-key-2')
    expect(gatewayCredentialsFingerprint()).not.toBe(before)
  })

  it('changes when the gateway address or enabled/running state changes', () => {
    const before = gatewayCredentialsFingerprint()
    mocks.getCurrentConfig.mockReturnValue({ enabled: true, host: '127.0.0.2', port: 24444 })
    expect(gatewayCredentialsFingerprint()).not.toBe(before)

    mocks.getCurrentConfig.mockReturnValue({ enabled: true, host: '127.0.0.1', port: 23333 })
    mocks.isRunning.mockReturnValue(false)
    expect(gatewayCredentialsFingerprint()).not.toBe(before)
  })

  it('is stable across reads with unchanged state and never leaks the key', () => {
    const first = gatewayCredentialsFingerprint()
    expect(gatewayCredentialsFingerprint()).toBe(first)
    expect(first).not.toContain('gw-key-1')
  })
})
