import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

import { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol'
import { afterEach, describe, expect, it } from 'vitest'

import { connectBridgeLink } from '../src/link'

const sockets: net.Socket[] = []
const servers: net.Server[] = []
const paths: string[] = []

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy()
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()))
  for (const socketPath of paths.splice(0)) {
    if (process.platform !== 'win32') await rm(socketPath, { force: true })
  }
})

/** Host peer that records what the link sends and never answers a request. */
async function listenSilentHost() {
  const socketPath =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\cherry-dsh-link-${randomUUID()}`
      : path.join(os.tmpdir(), `cdl-${randomUUID().slice(0, 8)}.sock`)
  paths.push(socketPath)
  const requests: Array<{ method: string; params: Record<string, unknown> }> = []
  const notifications: Array<{ method: string; params: Record<string, unknown> }> = []
  const server = net.createServer((socket) => {
    sockets.push(socket)
    const transport = new JsonRpcLineTransport(socket, socket)
    transport.onRequest((method, params) => {
      requests.push({ method, params })
      return new Promise(() => {})
    })
    transport.onNotification((method, params) => notifications.push({ method, params }))
    transport.start()
  })
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, resolve)
  })
  return { socketPath, requests, notifications }
}

describe('connectBridgeLink', () => {
  it('notifies tool/cancel with the bridge call id when the tool AbortSignal fires', async () => {
    const host = await listenSilentHost()
    const link = connectBridgeLink({ socketPath: host.socketPath, onRequest: async () => ({}) })
    const controller = new AbortController()
    const pending = link.callTool({ sessionId: 'session-1', name: 'slow', args: {} }, controller.signal)
    await expect.poll(() => host.requests[0]?.method).toBe('tool/call')
    const callId = host.requests[0].params.callId

    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await expect
      .poll(() => host.notifications[0])
      .toEqual({
        method: 'tool/cancel',
        params: { sessionId: 'session-1', callId }
      })
  })

  it('rejects in-flight and later tool calls when the host disconnects', async () => {
    const host = await listenSilentHost()
    const link = connectBridgeLink({ socketPath: host.socketPath, onRequest: async () => ({}) })
    const pending = link.callTool({ sessionId: 'session-1', name: 'slow', args: {} })
    await expect.poll(() => host.requests[0]?.method).toBe('tool/call')

    for (const socket of sockets.splice(0)) socket.destroy()

    await expect(pending).rejects.toThrow()
    await expect.poll(() => link.connected).toBe(false)
    await expect(link.callTool({ sessionId: 'session-1', name: 'slow', args: {} })).rejects.toThrow('not connected')
  })
})
