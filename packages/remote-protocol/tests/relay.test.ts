import { describe, expect, it } from 'vitest'

import { remoteEndpointSnapshotSchema } from '../src/connection'
import { relayEndpointSchema, relayOriginSchema } from '../src/relay'

describe('Relay address metadata', () => {
  it('canonicalizes an HTTPS origin and rejects credentials and paths', () => {
    expect(relayOriginSchema.parse('https://RELAY.example.com:443/')).toBe('https://relay.example.com')
    for (const value of [
      'http://relay.test',
      'https://user@relay.test',
      'https://relay.test/v1/relay',
      'https://relay.test?token=secret',
      'https://relay.test#x',
      'https://relay.test\\evil'
    ])
      expect(relayOriginSchema.safeParse(value).success).toBe(false)
    expect(
      relayEndpointSchema.safeParse({ origin: 'https://relay.test', targetId: 'a'.repeat(64), hostKey: 'secret' })
        .success
    ).toBe(false)
  })
  it('distinguishes an older desktop omitting Relay from explicitly disabling it', () => {
    const old = remoteEndpointSnapshotSchema.parse({ desktopIdentity: 'desktop', endpoints: [] })
    expect(old.relay).toBeUndefined()
    expect(remoteEndpointSnapshotSchema.parse({ ...old, relay: null }).relay).toBeNull()
  })
})
