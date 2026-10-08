import { once } from 'node:events'

import type { ComponentLogger, Logger } from '@libp2p/interface'
import { expect, it } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'

import {
  acceptSecureChannel,
  connectSecureChannel,
  createDeviceIdentity,
  deviceIdentityId,
  RemoteSocketStream
} from '../src/index'

const silent = (): Logger => Object.assign(() => {}, { error() {}, trace() {}, enabled: false, newScope: silent })
const logger: ComponentLogger = { forComponent: silent }

it('carries encrypted Unicode JSON-RPC across real WebSocket sockets without exposing plaintext', async () => {
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
    const options = { logger, protocolVersions: [1], signal: AbortSignal.timeout(3000) }
    const [client, host] = await Promise.all([
      connectSecureChannel(new RemoteSocketStream(socket, silent(), 'outbound'), {
        ...options,
        identity: mobile,
        remoteIdentity: deviceIdentityId(desktop)
      }),
      acceptSecureChannel(new RemoteSocketStream(accepted, silent(), 'inbound'), { ...options, identity: desktop })
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
    await Promise.all([client.close(), host.close()])
  } finally {
    socket.terminate()
    for (const client of server.clients) client.terminate()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
