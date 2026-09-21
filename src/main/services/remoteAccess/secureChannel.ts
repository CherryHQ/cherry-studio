import { createHash, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'

import nacl from 'tweetnacl'
import * as z from 'zod'

const encodedKey = z.string().regex(/^[A-Za-z0-9+/]{43}=$/)
const helloSchema = z.strictObject({
  type: z.literal('hello'),
  version: z.literal(1),
  publicKey: encodedKey,
  nonce: encodedKey
})
const MAX_COUNTER = (1n << 64n) - 1n
const HEADER_BYTES = 41
export const MAX_FRAME_BYTES = 1024 * 1024

function digest(bytes: Uint8Array): Buffer {
  return createHash('sha256').update(bytes).digest()
}

function nonceFor(sessionId: Buffer, direction: number, counter: bigint): Buffer {
  const nonce = Buffer.alloc(24)
  sessionId.copy(nonce, 0, 0, 12)
  nonce[12] = 1
  nonce[13] = direction
  nonce.writeBigUInt64BE(counter, 16)
  return nonce
}

function headerFor(sessionId: Buffer, direction: number, counter: bigint): Buffer {
  const header = Buffer.alloc(HEADER_BYTES)
  sessionId.copy(header)
  header[32] = direction
  header.writeBigUInt64BE(counter, 33)
  return header
}

export class SecureChannel {
  private incomingCounter = 0n
  private outgoingCounter = 0n
  private disposed = false

  constructor(
    private readonly incomingKey: Buffer,
    private readonly outgoingKey: Buffer,
    private readonly sessionId: Buffer
  ) {}

  seal(payload: Uint8Array): Buffer {
    this.assertOpen(this.outgoingCounter)
    if (payload.byteLength + 24 + HEADER_BYTES + nacl.secretbox.overheadLength > MAX_FRAME_BYTES) {
      throw new Error('FRAME_TOO_LARGE')
    }
    const counter = this.outgoingCounter++
    const nonce = nonceFor(this.sessionId, 1, counter)
    const plaintext = Buffer.concat([headerFor(this.sessionId, 1, counter), payload])
    return Buffer.concat([nonce, nacl.secretbox(plaintext, nonce, this.outgoingKey)])
  }

  open(frame: Uint8Array): Buffer {
    this.assertOpen(this.incomingCounter)
    if (frame.byteLength < 24 + HEADER_BYTES + nacl.secretbox.overheadLength || frame.byteLength > MAX_FRAME_BYTES) {
      throw new Error('INVALID_FRAME')
    }
    const nonce = nonceFor(this.sessionId, 0, this.incomingCounter)
    if (!timingSafeEqual(nonce, frame.subarray(0, 24))) throw new Error('INVALID_FRAME')
    const plain = nacl.secretbox.open(frame.subarray(24), nonce, this.incomingKey)
    if (
      !plain ||
      !timingSafeEqual(headerFor(this.sessionId, 0, this.incomingCounter), plain.subarray(0, HEADER_BYTES))
    ) {
      throw new Error('INVALID_FRAME')
    }
    this.incomingCounter++
    return Buffer.from(plain.subarray(HEADER_BYTES))
  }

  dispose(): void {
    this.disposed = true
    this.incomingKey.fill(0)
    this.outgoingKey.fill(0)
    this.sessionId.fill(0)
  }

  private assertOpen(counter: bigint): void {
    if (this.disposed || counter > MAX_COUNTER) throw new Error('SESSION_CLOSED')
  }
}

export function acceptHello(value: unknown, identity: { instanceId: string; secretKey: Uint8Array }) {
  const hello = helloSchema.parse(value)
  const clientKey = Buffer.from(hello.publicKey, 'base64')
  const clientNonce = Buffer.from(hello.nonce, 'base64')
  if (clientKey.toString('base64') !== hello.publicKey || clientNonce.toString('base64') !== hello.nonce) {
    throw new Error('INVALID_HELLO')
  }
  const rawShared = nacl.scalarMult(identity.secretKey, clientKey)
  const invalidKey = rawShared.every((byte) => byte === 0)
  rawShared.fill(0)
  if (invalidKey) throw new Error('INVALID_HELLO')
  const serverKey = Buffer.from(nacl.box.keyPair.fromSecretKey(identity.secretKey).publicKey).toString('base64')
  const serverNonce = randomBytes(32)
  const transcript = Buffer.from(
    JSON.stringify([
      'cherry-remote/v1',
      identity.instanceId,
      serverKey,
      hello.publicKey,
      hello.nonce,
      serverNonce.toString('base64')
    ])
  )
  const transcriptHash = digest(transcript)
  const shared = nacl.box.before(clientKey, identity.secretKey)
  const salt = digest(Buffer.concat([Buffer.from('cherry-remote/v1/salt\0'), clientNonce, serverNonce]))
  const info = Buffer.concat([Buffer.from('cherry-remote/v1/session\0'), transcriptHash])
  const expanded = Buffer.from(hkdfSync('sha256', shared, salt, info, 96))
  shared.fill(0)
  const channel = new SecureChannel(
    Buffer.from(expanded.subarray(0, 32)),
    Buffer.from(expanded.subarray(32, 64)),
    Buffer.from(expanded.subarray(64))
  )
  expanded.fill(0)
  return {
    channel,
    ready: {
      type: 'ready' as const,
      version: 1,
      instanceId: identity.instanceId,
      publicKey: serverKey,
      nonce: serverNonce.toString('base64')
    },
    transcriptHash: transcriptHash.toString('base64')
  }
}
