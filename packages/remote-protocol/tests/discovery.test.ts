import { describe, expect, it } from 'vitest'

import {
  directEndpointSchema,
  directEndpointUrl,
  parseDirectEndpoint,
  remoteDiscoveryTxtSchema
} from '../src/discovery'

describe('direct desktop locations', () => {
  it('deduplicates expanded native IPv6 and compact configured addresses', () => {
    const discovered = directEndpointSchema.parse({ host: 'fd00:0:0:0:0:0:0:1', port: 24444, security: 'ws' })
    expect(directEndpointUrl(discovered)).toBe(directEndpointUrl(parseDirectEndpoint('ws://[fd00::1]:24444')))
  })
  it.each([
    ['ws://DESKTOP.example:23333', 'ws://desktop.example:23333/v1/remote/connect'],
    ['wss://desktop.example', 'wss://desktop.example:443/v1/remote/connect'],
    ['ws://[fd00::1]:24444/v1/remote/connect', 'ws://[fd00::1]:24444/v1/remote/connect']
  ])('normalizes %s while preserving DNS names', (input, expected) => {
    expect(directEndpointUrl(parseDirectEndpoint(input))).toBe(expected)
  })
  it.each([
    'https://desktop.example',
    'ws://user:secret@desktop.example',
    'ws://desktop.example/agent',
    'ws://desktop.example/?token=x',
    'ws://desktop.example/#x',
    'ws://desktop.example:0',
    'ws://desktop.example:65536',
    'ws://[fe80::1%en0]:23333',
    'ws://desktop.example/a/../',
    'ws://desktop.example?',
    'ws:desktop.example',
    'ws://desktop.example\\evil',
    ' ws://desktop.example'
  ])('rejects non-ingress or ambiguous address %s', (input) => {
    expect(() => parseDirectEndpoint(input)).toThrow()
  })
  it('bounds untrusted TXT identities and rejects unknown versions', () => {
    expect(remoteDiscoveryTxtSchema.safeParse({ v: '1', identity: 'a'.repeat(129) }).success).toBe(false)
    expect(remoteDiscoveryTxtSchema.safeParse({ v: '2', identity: 'peer1' }).success).toBe(false)
    expect(remoteDiscoveryTxtSchema.parse({ v: '1', identity: 'peer1', secret: 'discarded' })).toEqual({
      v: '1',
      identity: 'peer1'
    })
  })
})
