import { createHash, hkdfSync, randomBytes } from 'node:crypto'

import nacl from 'tweetnacl'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'

import { RemoteServer } from '../server'

const identity = { instanceId: 'fixture-desktop', secretKey: nacl.box.keyPair().secretKey }
const serverPublicKey = nacl.box.keyPair.fromSecretKey(identity.secretKey).publicKey
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest()

/** A client written from the documented wire contract, independent of the desktop's own channel code. */
class TestClient {
  private readonly keys = nacl.box.keyPair()
  private readonly nonce = randomBytes(32)
  private readonly frames: Buffer[] = []
  private waiting?: (frame: Buffer) => void
  private outgoing = 0n
  private incoming = 0n
  private sendKey = Buffer.alloc(0)
  private receiveKey = Buffer.alloc(0)
  private sessionId = Buffer.alloc(0)
  transcriptHash = ''
  readonly closed: Promise<void>

  constructor(readonly socket: WebSocket) {
    this.closed = new Promise((resolve) => socket.once('close', () => resolve()))
    socket.on('error', () => {})
    socket.on('message', (raw) => {
      const frame = raw as Buffer
      if (this.waiting) {
        this.waiting(frame)
        this.waiting = undefined
      } else this.frames.push(frame)
    })
  }

  private next(): Promise<Buffer> {
    const queued = this.frames.shift()
    return queued ? Promise.resolve(queued) : new Promise((resolve) => (this.waiting = resolve))
  }

  private frameParts(direction: number, counter: bigint) {
    const nonce = Buffer.alloc(24)
    this.sessionId.copy(nonce, 0, 0, 12)
    nonce[12] = 1
    nonce[13] = direction
    nonce.writeBigUInt64BE(counter, 16)
    const header = Buffer.alloc(41)
    this.sessionId.copy(header)
    header[32] = direction
    header.writeBigUInt64BE(counter, 33)
    return { nonce, header }
  }

  send(value: unknown): void {
    const { nonce, header } = this.frameParts(0, this.outgoing++)
    const box = nacl.secretbox(Buffer.concat([header, Buffer.from(JSON.stringify(value))]), nonce, this.sendKey)
    this.socket.send(Buffer.concat([nonce, box]))
  }

  async receive(): Promise<any> {
    const frame = await this.next()
    const { nonce, header } = this.frameParts(1, this.incoming++)
    expect(frame.subarray(0, 24).equals(nonce)).toBe(true)
    const plain = nacl.secretbox.open(frame.subarray(24), nonce, this.receiveKey)
    if (!plain) throw new Error('Desktop frame did not authenticate')
    expect(Buffer.from(plain.subarray(0, 41)).equals(header)).toBe(true)
    return JSON.parse(Buffer.from(plain.subarray(41)).toString())
  }

  async handshake(): Promise<void> {
    await new Promise((resolve) => this.socket.once('open', resolve))
    const publicKey = Buffer.from(this.keys.publicKey).toString('base64')
    this.socket.send(JSON.stringify({ type: 'hello', version: 1, publicKey, nonce: this.nonce.toString('base64') }))
    const ready = JSON.parse((await this.next()).toString())
    expect(ready.publicKey).toBe(Buffer.from(serverPublicKey).toString('base64'))
    const hash = sha(
      Buffer.from(
        JSON.stringify([
          'cherry-remote/v1',
          ready.instanceId,
          ready.publicKey,
          publicKey,
          this.nonce.toString('base64'),
          ready.nonce
        ])
      )
    )
    const salt = sha(
      Buffer.concat([Buffer.from('cherry-remote/v1/salt\0'), this.nonce, Buffer.from(ready.nonce, 'base64')])
    )
    const keys = Buffer.from(
      hkdfSync(
        'sha256',
        nacl.box.before(serverPublicKey, this.keys.secretKey),
        salt,
        Buffer.concat([Buffer.from('cherry-remote/v1/session\0'), hash]),
        96
      )
    )
    this.sendKey = keys.subarray(0, 32)
    this.receiveKey = keys.subarray(32, 64)
    this.sessionId = keys.subarray(64)
    this.transcriptHash = hash.toString('base64')
    expect(await this.receive()).toEqual({ type: 'confirm', transcriptHash: this.transcriptHash })
  }

  async authenticate(token: string): Promise<any> {
    await this.handshake()
    this.send({ type: 'auth', mode: 'device', transcriptHash: this.transcriptHash, token })
    return this.receive()
  }
}

describe('remote listener admission and device sessions', () => {
  let server: RemoteServer
  const received: Array<{ deviceId: string; value: unknown }> = []
  let disposed: Promise<void>

  async function start(): Promise<number> {
    received.length = 0
    let markDisposed!: () => void
    disposed = new Promise((resolve) => (markDisposed = resolve))
    server = new RemoteServer({
      host: '127.0.0.1',
      port: 0,
      identity,
      authenticate: ({ token }) => {
        if (!token.startsWith('cs-dt-')) throw new Error('AUTH_FAILED')
        return { deviceId: token.slice('cs-dt-'.length) }
      },
      connected: (deviceId, send) => ({
        receive: (value) => {
          received.push({ deviceId, value })
          send({ echoed: value })
        },
        dispose: () => markDisposed()
      }),
      failed: () => {}
    })
    await server.start()
    return server.port
  }

  const connect = (port: number, options: { path?: string; headers?: Record<string, string> } = {}) =>
    new TestClient(
      new WebSocket(`ws://127.0.0.1:${port}${options.path ?? '/remote/v1/connect'}`, { headers: options.headers })
    )

  afterEach(async () => {
    await server.stop()
  })

  it('refuses upgrades on another path, for another host, or from an unrelated browser origin', async () => {
    const port = await start()
    await connect(port, { path: '/remote/v1/other' }).closed
    await connect(port, { headers: { host: 'desktop.example:80' } }).closed
    await connect(port, { headers: { origin: 'https://attacker.example' } }).closed
    expect(received).toEqual([])

    const sameOrigin = connect(port, { headers: { origin: `http://127.0.0.1:${port}` } })
    expect(await sameOrigin.authenticate('cs-dt-phone')).toMatchObject({ type: 'authenticated', deviceId: 'phone' })
  })

  it('carries requests only after the documented handshake and device authentication', async () => {
    const client = connect(await start())
    const authenticated = await client.authenticate('cs-dt-phone')
    expect(authenticated).toMatchObject({ type: 'authenticated', deviceId: 'phone' })
    expect(authenticated.expiresAt).toBeGreaterThan(Date.now())

    client.send({ type: 'request', requestId: 'r1' })
    expect(await client.receive()).toEqual({ echoed: { type: 'request', requestId: 'r1' } })
    expect(received).toEqual([{ deviceId: 'phone', value: { type: 'request', requestId: 'r1' } }])
  })

  it('closes without a reply for an unknown token or a transcript that does not match this connection', async () => {
    const port = await start()
    const unknown = connect(port)
    await unknown.handshake()
    unknown.send({ type: 'auth', mode: 'device', transcriptHash: unknown.transcriptHash, token: 'not-a-device-token' })
    await unknown.closed

    const replayed = connect(port)
    await replayed.handshake()
    replayed.send({ type: 'auth', mode: 'device', transcriptHash: unknown.transcriptHash, token: 'cs-dt-phone' })
    await replayed.closed
    expect(received).toEqual([])
  })

  it('closes a connection that sends plaintext once the channel is encrypted', async () => {
    const client = connect(await start())
    await client.handshake()
    client.socket.send(JSON.stringify({ type: 'auth', mode: 'device', token: 'cs-dt-phone' }))
    await client.closed
    expect(received).toEqual([])
  })

  it('lets a reconnecting device replace its old connection and drops a revoked device', async () => {
    const port = await start()
    const first = connect(port)
    await first.authenticate('cs-dt-phone')
    const second = connect(port)
    await second.authenticate('cs-dt-phone')
    await first.closed

    server.disconnect('phone')
    await second.closed
  })

  it('stops serving a client that exceeds the request burst allowance', async () => {
    const client = connect(await start())
    await client.authenticate('cs-dt-phone')
    for (let index = 0; index < 40; index++) client.send({ type: 'request', requestId: `r${index}` })
    // Observed on the desktop side: a peer closed with unread data may not notice until its next write.
    await disposed
    expect(received).toHaveLength(30)
  })
})
