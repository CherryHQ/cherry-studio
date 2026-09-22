import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it } from 'vitest'

import { isLoopbackAddress, screenLanRequest } from '../lanGuard'

/** A minimal request-like carrying an injected peer address, as srvx exposes via `.ip`. */
const requestFrom = (method: string, ip: string | undefined): Request => ({ method, ip }) as unknown as Request

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
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.api_gateway.host', '0.0.0.0')
  })

  it('lets a loopback caller through', () => {
    expect(screenLanRequest(requestFrom('POST', '127.0.0.1'))).toBeUndefined()
  })

  it('blocks every LAN caller', () => {
    expect(screenLanRequest(requestFrom('POST', '192.168.1.8'))).toEqual({
      error: expect.stringContaining('not reachable over the LAN')
    })
  })

  it('reports disabled LAN access before the route restriction', () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.api_gateway.host', '127.0.0.1')
    expect(screenLanRequest(requestFrom('GET', '192.168.1.8'))).toEqual({ error: 'Forbidden: LAN access is disabled' })
  })
})
