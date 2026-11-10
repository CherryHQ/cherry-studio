import * as native from 'node:crypto'
import { once } from 'node:events'

import type { ComponentLogger, Logger } from '@libp2p/interface'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'

import { uploadTransferLimits } from '@cherrystudio/remote-protocol'

import {
  acceptSecureChannel,
  connectSecureChannel,
  createDeviceIdentity,
  deviceIdentityId,
  createNativeNoiseCrypto,
  RemoteSocketStream
} from '../src/index'

const silent = (): Logger => Object.assign(() => {}, { error() {}, trace() {}, enabled: false, newScope: silent })
const logger: ComponentLogger = { forComponent: silent }

it('carries encrypted JSON and MiB records without exposing plaintext', async () => {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1', maxPayload: 65_536, perMessageDeflate: false })
  await once(server, 'listening')
  const address = server.address()
  if (typeof address === 'string' || address === null) throw new Error('Expected TCP listener')
  const incoming = once(server, 'connection')
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}`)
  try {
    await once(socket, 'open')
    const [accepted] = (await incoming) as [WebSocket]
    const packets: Buffer[] = []
    // Noise decrypts in place, so copy each frame before the stream consumes it.
    accepted.on('message', (data) => {
      packets.push(Buffer.from(new Uint8Array(data as ArrayBuffer)))
    })
    const [desktop, mobile] = await Promise.all([createDeviceIdentity(), createDeviceIdentity()])
    const options = { logger, protocolVersions: [1], signal: AbortSignal.timeout(30000) }
    const [client, host] = await Promise.all([
      connectSecureChannel(new RemoteSocketStream(socket, silent(), 'outbound'), {
        ...options,
        identity: mobile,
        crypto: createNativeNoiseCrypto(native),
        remoteIdentity: deviceIdentityId(desktop)
      }),
      acceptSecureChannel(new RemoteSocketStream(accepted, silent(), 'inbound'), {
        ...options,
        identity: desktop
      })
    ])
    const payload = {
      jsonrpc: '2.0',
      id: 'request',
      method: 'connection.ping',
      params: { nonce: '机密🌍'.repeat(5000) }
    }
    await client.write(payload)
    expect(await host.read(options.signal)).toEqual(payload)
    expect(Buffer.concat(packets).includes(Buffer.from('机密🌍'))).toBe(false)
    await host.write({ jsonrpc: '2.0', id: 'request', result: { nonce: 'ok' } })
    expect(await client.read(options.signal)).toMatchObject({ result: { nonce: 'ok' } })
    {
      const chunk = {
        kind: 'upload',
        requestId: 'r',
        uploadId: 'u',
        writerEpoch: '1',
        offset: '0',
        bytes: native.randomBytes(1024 * 1024)
      }
      await client.write(chunk)
      const received = (await host.read(options.signal)) as typeof chunk
      expect(Buffer.from(received.bytes).equals(chunk.bytes)).toBe(true)
      expect(packets.every((packet) => packet.length <= 65536)).toBe(true)
      await host.write({ jsonrpc: '2.0', method: 'ack', params: { committedOffset: '1048576' } })
      expect(await client.read(options.signal)).toMatchObject({ params: { committedOffset: '1048576' } })
    }
    await Promise.all([client.close(), host.close()])
  } finally {
    socket.terminate()
    for (const client of server.clients) client.terminate()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

class MockSocket {
  binaryType = ''
  bufferedAmount = 0
  readyState = 1
  sent: Uint8Array[] = []
  closed: number | undefined
  send(data: Uint8Array) {
    this.sent.push(data)
  }
  close(code?: number) {
    this.closed = code
  }
  addEventListener() {}
  removeEventListener() {}
}

describe('RemoteSocketStream backpressure', () => {
  afterEach(() => vi.useRealTimers())

  it('pauses at the queued-bytes cap and resumes once bufferedAmount drains', async () => {
    vi.useFakeTimers()
    const socket = new MockSocket()
    const stream = new RemoteSocketStream(socket, silent(), 'outbound')
    const aborted = vi.fn()
    stream.addEventListener('close', aborted)
    socket.bufferedAmount = uploadTransferLimits.queuedBytes - 10

    stream.send(new Uint8Array(100))
    await vi.advanceTimersByTimeAsync(1000)
    expect(socket.sent).toHaveLength(0)
    expect(aborted).not.toHaveBeenCalled()
    expect(stream.status).toBe('open')

    socket.bufferedAmount = 0
    await vi.advanceTimersByTimeAsync(1000)
    expect(socket.sent).toHaveLength(1)
    expect(socket.sent[0].byteLength).toBe(100)
    expect(aborted).not.toHaveBeenCalled()
  })

  it('aborts when the socket stays congested past the stall timeout', async () => {
    vi.useFakeTimers()
    const socket = new MockSocket()
    const stream = new RemoteSocketStream(socket, silent(), 'outbound')
    const closed = vi.fn()
    stream.addEventListener('close', closed)
    socket.bufferedAmount = uploadTransferLimits.queuedBytes

    stream.send(new Uint8Array(100))
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(socket.sent).toHaveLength(0)
    expect(closed).toHaveBeenCalledTimes(1)
  })

  it('still aborts on a closed socket', () => {
    const socket = new MockSocket()
    const stream = new RemoteSocketStream(socket, silent(), 'outbound')
    socket.readyState = 3
    expect(() => stream.send(new Uint8Array(10))).toThrow('Remote socket unavailable')
  })
})
