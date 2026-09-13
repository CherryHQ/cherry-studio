import { describe, expect, it } from 'vitest'

import { isLanAllowedRoute, isLoopbackAddress, screenLanRequest } from '../lanGuard'

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

describe('isLanAllowedRoute', () => {
  it('permits only the pairing bootstrap and the provider export', () => {
    expect(isLanAllowedRoute('POST', '/pair')).toBe(true)
    expect(isLanAllowedRoute('GET', '/v1/export/providers')).toBe(true)
  })

  it('rejects the export under the wrong method and the pairing under the wrong method', () => {
    expect(isLanAllowedRoute('GET', '/pair')).toBe(false)
    expect(isLanAllowedRoute('POST', '/v1/export/providers')).toBe(false)
  })

  it('rejects the generation, MCP, and knowledge routes', () => {
    for (const path of ['/v1/chat/completions', '/v1/messages', '/v1/mcps/x/mcp', '/v1/knowledge-bases']) {
      expect(isLanAllowedRoute('POST', path)).toBe(false)
    }
  })
})

describe('screenLanRequest', () => {
  it('lets a loopback caller reach a loopback-only route', () => {
    expect(screenLanRequest(requestFrom('POST', '127.0.0.1'), '/v1/chat/completions')).toBeUndefined()
  })

  it('blocks a LAN caller from a loopback-only route', () => {
    expect(screenLanRequest(requestFrom('POST', '192.168.1.8'), '/v1/chat/completions')).toEqual({
      error: expect.stringContaining('not reachable over the LAN')
    })
  })

  it('lets a LAN caller reach the pairing bootstrap and provider export', () => {
    expect(screenLanRequest(requestFrom('POST', '192.168.1.8'), '/pair')).toBeUndefined()
    expect(screenLanRequest(requestFrom('GET', '192.168.1.8'), '/v1/export/providers')).toBeUndefined()
  })
})
