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

import { readApiGatewayConnectionSnapshot } from '../agentApiGateway'

describe('readApiGatewayConnectionSnapshot', () => {
  beforeEach(() => {
    mocks.getCurrentConfig.mockReturnValue({ enabled: true, host: '127.0.0.1', port: 23333 })
    mocks.isRunning.mockReturnValue(true)
    mocks.getPreference.mockReturnValue('gw-key-1')
  })

  it('changes when the gateway key rotates', () => {
    const before = readApiGatewayConnectionSnapshot().fingerprint
    mocks.getPreference.mockReturnValue('gw-key-2')
    expect(readApiGatewayConnectionSnapshot().fingerprint).not.toBe(before)
  })

  it('changes when the gateway address or state changes', () => {
    const before = readApiGatewayConnectionSnapshot().fingerprint
    mocks.getCurrentConfig.mockReturnValue({ enabled: true, host: '127.0.0.2', port: 24444 })
    expect(readApiGatewayConnectionSnapshot()).not.toMatchObject({ fingerprint: before })

    mocks.getCurrentConfig.mockReturnValue({ enabled: true, host: '127.0.0.1', port: 23333 })
    mocks.isRunning.mockReturnValue(false)
    expect(readApiGatewayConnectionSnapshot().fingerprint).not.toBe(before)
  })

  it('is stable across reads with unchanged state and never leaks the key', () => {
    const first = readApiGatewayConnectionSnapshot()
    expect(readApiGatewayConnectionSnapshot()).toEqual(first)
    expect(first).toMatchObject({ baseUrl: 'http://127.0.0.1:23333', enabled: true })
    expect(first.fingerprint).not.toContain('gw-key-1')
  })
})
