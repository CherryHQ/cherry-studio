import { describe, expect, it } from 'vitest'

import fixtures from '../fixtures/pairing-qr.json'
import { advertisedEndpointSchema, directEndpointUrl, pairingQrSchema, parseDirectEndpoint } from '../src/index'

const proof = {
  t: 'cherry-studio-pair',
  name: 'Desktop',
  desktopIdentity: '12D3KooWDesktop',
  invitationId: 'invitation',
  invitationSecret: 'secret',
  protocolVersions: [1]
}

describe('pairing addresses', () => {
  it.each(fixtures)('shared Mobile contract: $name', ({ input, valid }) => {
    expect(pairingQrSchema.safeParse(input).success).toBe(valid)
  })
  it('preserves domain, TLS and external port without changing the pairing proof', () => {
    const qr = pairingQrSchema.parse({
      ...proof,
      v: 3,
      endpoints: [{ host: 'Desktop.example.com', port: 443, security: 'wss' }]
    })
    expect(qr).toMatchObject({ ...proof, endpoints: [{ host: 'desktop.example.com', port: 443, security: 'wss' }] })
    if (qr.v !== 3) throw new Error('Expected v3')
    expect(directEndpointUrl(qr.endpoints[0])).toBe('wss://desktop.example.com:443/v1/remote/connect')
  })

  it('continues accepting legacy IP invitations without permitting domains in ips', () => {
    expect(pairingQrSchema.parse({ ...proof, v: 2, ips: ['192.168.1.8'], port: 24444 })).toMatchObject({
      ips: ['192.168.1.8'],
      port: 24444
    })
    expect(pairingQrSchema.safeParse({ ...proof, v: 2, ips: ['desktop.example.com'], port: 443 }).success).toBe(false)
    expect(pairingQrSchema.safeParse({ ...proof, v: 3, endpoints: [] }).success).toBe(false)
  })

  it.each([
    '',
    '0.0.0.0',
    '::',
    '::1',
    'localhost',
    'host.localhost',
    '127.0.0.1',
    '127.1',
    '2130706433',
    '::ffff:127.0.0.1',
    'user@host',
    'host/path',
    'host?query',
    'host#fragment',
    '999.999.999.999'
  ])('rejects unusable remote destination %s', (host) => {
    expect(advertisedEndpointSchema.safeParse({ host, port: 23333, security: 'ws' }).success).toBe(false)
  })

  it.each([0, 65536, 1.5])('rejects invalid port %s', (port) => {
    expect(advertisedEndpointSchema.safeParse({ host: 'desktop.example.com', port, security: 'wss' }).success).toBe(
      false
    )
  })

  it('accepts HTTP address input without downgrading HTTPS or losing an explicit port', () => {
    expect(parseDirectEndpoint('https://Desktop.example.com:24443')).toEqual({
      host: 'desktop.example.com',
      port: 24443,
      security: 'wss'
    })
    expect(parseDirectEndpoint('https://desktop.example.com')).toEqual({
      host: 'desktop.example.com',
      port: 443,
      security: 'wss'
    })
    expect(parseDirectEndpoint('http://192.168.1.8:24444/v1/remote/connect')).toEqual({
      host: '192.168.1.8',
      port: 24444,
      security: 'ws'
    })
  })

  it('supports bracketed IPv6 URLs and normalizes hosts', () => {
    const endpoint = advertisedEndpointSchema.parse({ host: '2001:db8::1', port: 24444, security: 'wss' })
    expect(directEndpointUrl(endpoint)).toBe('wss://[2001:db8::1]:24444/v1/remote/connect')
  })
})
