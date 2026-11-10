import type { ComponentLogger, Logger } from '@libp2p/interface'
import { streamPair } from '@libp2p/utils'
import { describe, expect, it } from 'vitest'

import { acceptSecureChannel, connectSecureChannel, createDeviceIdentity, deviceIdentityId } from '../src/index'

const silent = (): Logger => Object.assign(() => {}, { error() {}, trace() {}, enabled: false, newScope: silent })
const logger: ComponentLogger = { forComponent: silent }

describe('authenticated remote channels', () => {
  it('authenticates both keys and preserves ordered Unicode records across Noise frames', async () => {
    const [desktop, mobile] = await Promise.all([createDeviceIdentity(), createDeviceIdentity()])
    const [outbound, inbound] = await streamPair()
    const options = { logger, protocolVersions: [1], signal: AbortSignal.timeout(3000) }
    const [client, server] = await Promise.all([
      connectSecureChannel(outbound, { ...options, identity: mobile, remoteIdentity: deviceIdentityId(desktop) }),
      acceptSecureChannel(inbound, { ...options, identity: desktop })
    ])
    expect(client.remoteIdentity).toBe(deviceIdentityId(desktop))
    expect(server.remoteIdentity).toBe(deviceIdentityId(mobile))
    const values = [{ text: '你好🌍'.repeat(5000) }, { next: 2 }]
    await Promise.all(values.map((value) => client.write(value)))
    expect(await server.read(options.signal)).toEqual(values[0])
    expect(await server.read(options.signal)).toEqual(values[1])
    await Promise.all([client.close(), server.close()])
  })

  it('rejects a valid but unpinned desktop identity', async () => {
    const [desktop, other, mobile] = await Promise.all([
      createDeviceIdentity(),
      createDeviceIdentity(),
      createDeviceIdentity()
    ])
    const [outbound, inbound] = await streamPair()
    const options = { logger, protocolVersions: [1], signal: AbortSignal.timeout(1000) }
    const result = await Promise.allSettled([
      connectSecureChannel(outbound, { ...options, identity: mobile, remoteIdentity: deviceIdentityId(other) }),
      acceptSecureChannel(inbound, { ...options, identity: desktop })
    ])
    expect(result.map((item) => item.status)).toEqual(['rejected', 'rejected'])
  })

  it('rejects unsupported whole versions before allowing application records', async () => {
    const [desktop, mobile] = await Promise.all([createDeviceIdentity(), createDeviceIdentity()])
    const [outbound, inbound] = await streamPair()
    const options = { logger, signal: AbortSignal.timeout(1000) }
    const result = await Promise.allSettled([
      connectSecureChannel(outbound, {
        ...options,
        protocolVersions: [2],
        identity: mobile,
        remoteIdentity: deviceIdentityId(desktop)
      }),
      acceptSecureChannel(inbound, { ...options, protocolVersions: [1], identity: desktop })
    ])
    expect(result.map((item) => item.status)).toEqual(['rejected', 'rejected'])
  })

  it('binds the complete version offer to the authenticated transcript', async () => {
    const [desktop, mobile] = await Promise.all([createDeviceIdentity(), createDeviceIdentity()])
    const [outbound, inbound] = await streamPair()
    const send = outbound.send.bind(outbound)
    let prelude = true
    outbound.send = (data) => {
      const bytes = Uint8Array.from(data instanceof Uint8Array ? data : data.subarray())
      if (prelude) {
        prelude = false
        bytes[bytes.indexOf('2'.charCodeAt(0))] = '3'.charCodeAt(0)
      }
      return send(bytes)
    }
    const options = { logger, signal: AbortSignal.timeout(1000) }
    const result = await Promise.allSettled([
      connectSecureChannel(outbound, {
        ...options,
        protocolVersions: [1, 2],
        identity: mobile,
        remoteIdentity: deviceIdentityId(desktop)
      }),
      acceptSecureChannel(inbound, { ...options, protocolVersions: [1], identity: desktop })
    ])
    expect(result.map((item) => item.status)).toEqual(['rejected', 'rejected'])
  })

  it.each(['tamper', 'replay'])('rejects %s of encrypted application records', async (attack) => {
    const [desktop, mobile] = await Promise.all([createDeviceIdentity(), createDeviceIdentity()])
    const [outbound, inbound] = await streamPair()
    const options = { logger, protocolVersions: [1], signal: AbortSignal.timeout(1000) }
    const [client, server] = await Promise.all([
      connectSecureChannel(outbound, { ...options, identity: mobile, remoteIdentity: deviceIdentityId(desktop) }),
      acceptSecureChannel(inbound, { ...options, identity: desktop })
    ])
    const send = outbound.send.bind(outbound)
    let ciphertext = new Uint8Array()
    outbound.send = (data) => {
      ciphertext = Uint8Array.from(data instanceof Uint8Array ? data : data.subarray())
      if (attack === 'tamper') ciphertext[ciphertext.length - 1] ^= 1
      return send(ciphertext)
    }
    await client.write({ secret: 'must not be accepted twice or altered' })
    if (attack === 'replay') {
      expect(await server.read(options.signal)).toEqual({ secret: 'must not be accepted twice or altered' })
      send(ciphertext)
    }
    await expect(server.read(options.signal)).rejects.toThrow()
    client.abort(new Error('Test complete'))
    server.abort(new Error('Test complete'))
  })
})
