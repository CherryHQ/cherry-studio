import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it } from 'vitest'

import { isLoopbackAddress, screenLanRequest } from '../lanGuard'

/** A minimal request-like carrying an injected peer address, as srvx exposes via `.ip`. */
const requestFrom = (method: string, ip: string | undefined, headers?: Record<string, string>): Request =>
  ({ method, ip, headers: new Headers(headers) }) as unknown as Request

describe('isLoopbackAddress', () => {
  it('accepts every loopback form the Node stack can present', () => {
    for (const address of ['127.0.0.1', '127.5.5.5', '::1', '::ffff:127.0.0.1']) {
      expect(isLoopbackAddress(address)).toBe(true)
    }
  })

  it('treats a missing address as loopback (in-process handle, no socket)', () => {
    expect(isLoopbackAddress(undefined)).toBe(true)
  })

  it('rejects LAN and mapped-LAN addresses', () => {
    for (const address of ['192.168.1.8', '10.0.0.5', '::ffff:192.168.1.8']) {
      expect(isLoopbackAddress(address)).toBe(false)
    }
  })
})

describe('screenLanRequest', () => {
  beforeEach(() => {
    MockMainPreferenceServiceUtils.resetMocks()
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.api_gateway.enabled', true)
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.api_gateway.host', '0.0.0.0')
  })

  it('lets a loopback caller through', () => {
    expect(screenLanRequest(requestFrom('POST', '127.0.0.1'), '/v1/chat/completions')).toBeUndefined()
  })

  it('blocks every LAN caller', () => {
    expect(screenLanRequest(requestFrom('POST', '192.168.1.8'), '/v1/chat/completions')).toEqual({
      error: expect.stringContaining('not reachable over the LAN')
    })
  })

  it('lets a LAN peer reach only the remote-access WebSocket upgrade', () => {
    expect(
      screenLanRequest(requestFrom('GET', '192.168.1.8', { upgrade: 'websocket' }), '/v1/remote/connect')
    ).toBeUndefined()
    expect(screenLanRequest(requestFrom('GET', '192.168.1.8'), '/v1/remote/connect')).toEqual({
      error: expect.stringContaining('not reachable over the LAN')
    })
    expect(screenLanRequest(requestFrom('GET', '192.168.1.8'), '/v1/mcps/x/mcp')).toEqual({
      error: expect.stringContaining('not reachable over the LAN')
    })
  })

  it.each(['127.0.0.1', '192.168.1.8'])(
    'blocks remote upgrades from %s when only a local lease keeps the gateway running',
    (address) => {
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.api_gateway.enabled', false)
      expect(screenLanRequest(requestFrom('GET', address, { upgrade: 'websocket' }), '/v1/remote/connect')).toEqual({
        error: 'Forbidden: LAN access is disabled'
      })
      expect(screenLanRequest(requestFrom('GET', '127.0.0.1'), '/health')).toBeUndefined()
    }
  )

  it('reports disabled LAN access before the route restriction', () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.api_gateway.host', '127.0.0.1')
    expect(screenLanRequest(requestFrom('GET', '192.168.1.8'), '/v1/remote/connect')).toEqual({
      error: 'Forbidden: LAN access is disabled'
    })
  })
})
