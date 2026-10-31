import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSocketServer } from 'ws'

import { RemoteDebuggingMonitor } from '../RemoteDebuggingMonitor'

describe.each([0, 6000])('RemoteDebuggingMonitor on port %i', (listenPort) => {
  let server: Server
  let sockets: WebSocketServer
  let monitor: RemoteDebuggingMonitor
  let port: number
  const changes = vi.fn()
  const commands: string[] = []

  beforeEach(async () => {
    changes.mockClear()
    commands.length = 0
    server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/test` }))
    })
    sockets = new WebSocketServer({ server })
    sockets.on('connection', (socket) => {
      socket.on('message', (data) => {
        const command = JSON.parse(data.toString())
        commands.push(command.method)
        socket.send(JSON.stringify({ id: command.id, result: {} }))
        socket.send(
          JSON.stringify({
            method: 'Target.targetCreated',
            params: {
              targetInfo: { targetId: 'page-one', type: 'webview', attached: true }
            }
          })
        )
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(listenPort, '127.0.0.1', resolve)
    })
    port = (server.address() as AddressInfo).port
    monitor = new RemoteDebuggingMonitor(async () => port, changes)
  })

  afterEach(async () => {
    monitor.stop()
    for (const client of sockets.clients) client.terminate()
    server.closeAllConnections()
    await new Promise<void>((resolve) => sockets.close(() => resolve()))
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  const notify = (method: string, params: unknown) => {
    for (const socket of sockets.clients) socket.send(JSON.stringify({ method, params }))
  }

  it('reports existing attachments and attach/detach changes without debugging pages itself', async () => {
    monitor.start()
    await vi.waitFor(() => expect(monitor.isAttached('page-one')).toBe(true))
    expect(commands).toEqual(['Target.setDiscoverTargets'])
    expect(changes).toHaveBeenLastCalledWith('page-one', true)
    notify('Target.targetInfoChanged', { targetInfo: { targetId: 'page-one', attached: false } })
    await vi.waitFor(() => expect(monitor.isAttached('page-one')).toBe(false))
    expect(changes).toHaveBeenLastCalledWith('page-one', false)
    notify('Target.targetInfoChanged', { targetInfo: { targetId: 'page-two', attached: true } })
    await vi.waitFor(() => expect(monitor.isAttached('page-two')).toBe(true))
    expect(monitor.isAttached('page-one')).toBe(false)
    notify('Target.targetDestroyed', { targetId: 'page-two' })
    await vi.waitFor(() => expect(monitor.isAttached('page-two')).toBe(false))
  })

  it('clears stale indicators when disconnected and observes attachments again after reconnecting', async () => {
    monitor.start()
    await vi.waitFor(() => expect(monitor.isAttached('page-one')).toBe(true))
    for (const client of sockets.clients) client.terminate()
    await vi.waitFor(() => expect(monitor.isAttached('page-one')).toBe(false))
    await vi.waitFor(() => expect(monitor.isAttached('page-one')).toBe(true), { timeout: 3000 })
    expect(commands).toEqual(['Target.setDiscoverTargets', 'Target.setDiscoverTargets'])
    monitor.stop()
    expect(monitor.isAttached('page-one')).toBe(false)
    expect(changes).toHaveBeenLastCalledWith('page-one', false)
  })

  it.each([false, true])('cancels discovery on stop (response body started: %s)', async (bodyStarted) => {
    const received = vi.fn()
    const closed = vi.fn()
    server.removeAllListeners('request')
    server.on('request', (_request, response) => {
      received()
      response.on('close', closed)
      if (bodyStarted) response.write('{"webSocketDebuggerUrl":')
    })

    monitor.start()
    await vi.waitFor(() => expect(received).toHaveBeenCalledTimes(1))
    monitor.stop()

    await vi.waitFor(() => expect(closed).toHaveBeenCalledTimes(1))
    expect(sockets.clients.size).toBe(0)
    expect(monitor.getAttachedTargetIds()).toEqual([])
  })

  it.each([false, true])('retries after a discovery timeout (response body started: %s)', async (bodyStarted) => {
    let requests = 0
    const closed = vi.fn()
    server.removeAllListeners('request')
    server.on('request', (_request, response) => {
      if (++requests === 1) {
        response.on('close', closed)
        if (bodyStarted) response.write('{"webSocketDebuggerUrl":')
        return
      }
      response.end(JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/test` }))
    })

    monitor.start()

    await vi.waitFor(() => expect(monitor.isAttached('page-one')).toBe(true), { timeout: 4500 })
    expect(closed).toHaveBeenCalledTimes(1)
    expect(requests).toBe(2)
    expect(commands).toEqual(['Target.setDiscoverTargets'])
  })
})
