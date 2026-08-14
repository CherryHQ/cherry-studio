import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { connectBridgeLink } from '../src/link'
import { createBridgeFrameDecoder } from '../src/protocol'

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

describe('connectBridgeLink', () => {
  it('sends a correlated cancellation frame when the tool AbortSignal fires', async () => {
    const socketPath =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\cherry-dsh-link-${randomUUID()}`
        : path.join(os.tmpdir(), `cdl-${randomUUID().slice(0, 8)}.sock`)
    paths.push(socketPath)
    const frames: Record<string, unknown>[] = []
    const server = net.createServer((socket) => {
      sockets.push(socket)
      socket.on(
        'data',
        createBridgeFrameDecoder((message) => frames.push(message as Record<string, unknown>))
      )
    })
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(socketPath, resolve)
    })

    const link = connectBridgeLink({ socketPath, onMessage: () => undefined, onDisconnect: () => undefined })
    const controller = new AbortController()
    const pending = link.callTool({ sessionId: 'session-1', name: 'slow', args: {} }, controller.signal)
    await expect.poll(() => frames[0]?.type).toBe('toolCall')

    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await expect
      .poll(() => frames[1])
      .toMatchObject({
        type: 'toolCallCancel',
        id: frames[0].id,
        sessionId: 'session-1'
      })
  })
})
