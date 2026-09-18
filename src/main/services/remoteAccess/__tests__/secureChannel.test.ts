import { createHash, hkdfSync } from 'node:crypto'

import nacl from 'tweetnacl'
import { describe, expect, it } from 'vitest'

import { acceptHello, SecureChannel } from '../secureChannel'

const incoming = Buffer.alloc(32, 1)
const outgoing = Buffer.alloc(32, 2)
const sessionId = Buffer.alloc(32, 3)
const createChannel = () => new SecureChannel(Buffer.from(incoming), Buffer.from(outgoing), Buffer.from(sessionId))

function clientFrame(text: string, counter = 0n, direction = 0, session = sessionId): Buffer {
  const nonce = Buffer.alloc(24)
  session.copy(nonce, 0, 0, 12)
  nonce[12] = 1
  nonce[13] = direction
  nonce.writeBigUInt64BE(counter, 16)
  const header = Buffer.alloc(41)
  session.copy(header)
  header[32] = direction
  header.writeBigUInt64BE(counter, 33)
  return Buffer.concat([nonce, nacl.secretbox(Buffer.concat([header, Buffer.from(text)]), nonce, incoming)])
}

describe('remote channel authentication and replay protection', () => {
  it('accepts an authenticated client frame exactly once', () => {
    const channel = createChannel()
    const frame = clientFrame('private conversation')
    expect(channel.open(frame).toString()).toBe('private conversation')
    expect(() => channel.open(frame)).toThrow()
    expect(channel.open(clientFrame('next', 1n)).toString()).toBe('next')
  })

  it('rejects tampering, a skipped counter, another session and reflected traffic', () => {
    const channel = createChannel()
    const modified = clientFrame('private conversation')
    modified[modified.length - 1] ^= 1
    expect(() => channel.open(modified)).toThrow()
    expect(() => channel.open(clientFrame('skip', 1n))).toThrow()
    expect(() => channel.open(clientFrame('wrong session', 0n, 0, Buffer.alloc(32, 4)))).toThrow()
    expect(() => channel.open(clientFrame('reflection', 0n, 1))).toThrow()
    expect(channel.open(clientFrame('valid')).toString()).toBe('valid')
  })

  it('encrypts responses for only the receiving direction and makes disposal terminal', () => {
    const channel = createChannel()
    const frame = channel.seal(Buffer.from('response'))
    const plain = nacl.secretbox.open(frame.subarray(24), frame.subarray(0, 24), outgoing)
    expect(plain && Buffer.from(plain.subarray(41)).toString()).toBe('response')
    expect(nacl.secretbox.open(frame.subarray(24), frame.subarray(0, 24), incoming)).toBeNull()
    expect(() => channel.open(frame)).toThrow()
    channel.dispose()
    expect(() => channel.seal(Buffer.from('late'))).toThrow()
    expect(() => channel.open(clientFrame('late'))).toThrow()
  })

  it('lets a client derive the handshake confirmation from the pinned desktop public key', () => {
    const desktop = nacl.box.keyPair.fromSecretKey(Buffer.alloc(32, 11))
    const client = nacl.box.keyPair.fromSecretKey(Buffer.alloc(32, 22))
    const clientNonce = Buffer.alloc(32, 33)
    const hello = {
      type: 'hello',
      version: 1,
      publicKey: Buffer.from(client.publicKey).toString('base64'),
      nonce: clientNonce.toString('base64')
    }
    const accepted = acceptHello(hello, { instanceId: 'fixture-desktop', secretKey: desktop.secretKey })
    expect(accepted.ready.publicKey).toBe(Buffer.from(desktop.publicKey).toString('base64'))
    const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest()
    const transcript = Buffer.from(
      JSON.stringify([
        'cherry-remote/v1',
        'fixture-desktop',
        accepted.ready.publicKey,
        hello.publicKey,
        hello.nonce,
        accepted.ready.nonce
      ])
    )
    const keys = Buffer.from(
      hkdfSync(
        'sha256',
        nacl.box.before(desktop.publicKey, client.secretKey),
        sha(
          Buffer.concat([
            Buffer.from('cherry-remote/v1/salt\0'),
            clientNonce,
            Buffer.from(accepted.ready.nonce, 'base64')
          ])
        ),
        Buffer.concat([Buffer.from('cherry-remote/v1/session\0'), sha(transcript)]),
        96
      )
    )
    const frame = accepted.channel.seal(Buffer.from('confirmed'))
    const plain = nacl.secretbox.open(frame.subarray(24), frame.subarray(0, 24), keys.subarray(32, 64))
    expect(plain && Buffer.from(plain.subarray(41)).toString()).toBe('confirmed')
    expect(Buffer.from(plain!.subarray(0, 32))).toEqual(keys.subarray(64))
    const reconnected = acceptHello(hello, { instanceId: 'fixture-desktop', secretKey: desktop.secretKey })
    expect(reconnected.ready.nonce).not.toBe(accepted.ready.nonce)
  })

  it('rejects a low-order client key rather than deriving a predictable session', () => {
    expect(() =>
      acceptHello(
        {
          type: 'hello',
          version: 1,
          publicKey: Buffer.alloc(32).toString('base64'),
          nonce: Buffer.alloc(32, 1).toString('base64')
        },
        { instanceId: 'pc', secretKey: Buffer.alloc(32, 9) }
      )
    ).toThrow()
  })
})
