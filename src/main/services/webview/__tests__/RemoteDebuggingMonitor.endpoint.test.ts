import { EventEmitter } from 'node:events'
import { get, type ClientRequest } from 'node:http'
import { Readable } from 'node:stream'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'

import { RemoteDebuggingMonitor } from '../RemoteDebuggingMonitor'

vi.mock('ws', () => ({ default: vi.fn() }))
vi.mock('node:http', () => ({ get: vi.fn() }))

describe('RemoteDebuggingMonitor endpoint validation', () => {
  let monitor: RemoteDebuggingMonitor
  let request: EventEmitter
  let socket: EventEmitter & { send: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    request = new EventEmitter()
    vi.mocked(get)
      .mockReset()
      .mockReturnValue(request as ClientRequest)
    socket = Object.assign(new EventEmitter(), { send: vi.fn(), terminate: vi.fn() })
    vi.mocked(WebSocket)
      .mockReset()
      .mockImplementation(function () {
        return socket as unknown as WebSocket
      })
  })

  afterEach(() => {
    monitor.stop()
  })

  async function serveVersion(webSocketDebuggerUrl: string) {
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(1))
    request.emit('response', Readable.from([JSON.stringify({ webSocketDebuggerUrl })]))
  }

  it.each(['ws://127.0.0.1:80/devtools/browser/test', 'ws://127.0.0.1/devtools/browser/test'])(
    'observes attachments on port 80 advertised as %s',
    async (webSocketDebuggerUrl) => {
      monitor = new RemoteDebuggingMonitor(async () => 80, vi.fn())
      monitor.start()
      await serveVersion(webSocketDebuggerUrl)

      await vi.waitFor(() => expect(WebSocket).toHaveBeenCalledTimes(1))
      socket.emit('open')
      expect(JSON.parse(socket.send.mock.calls[0][0])).toEqual({
        id: 1,
        method: 'Target.setDiscoverTargets',
        params: { discover: true }
      })
      socket.emit(
        'message',
        JSON.stringify({
          method: 'Target.targetCreated',
          params: { targetInfo: { targetId: 'page-at-port-80', attached: true } }
        })
      )
      expect(monitor.isAttached('page-at-port-80')).toBe(true)
    }
  )

  it.each([
    'wss://127.0.0.1:80/devtools/browser/test',
    'ws://192.0.2.1:80/devtools/browser/test',
    'ws://127.0.0.1:9342/devtools/browser/test',
    'ws://127.0.0.1:80/devtools/page/test'
  ])('rejects an unexpected endpoint %s before opening a socket', async (webSocketDebuggerUrl) => {
    monitor = new RemoteDebuggingMonitor(async () => 80, vi.fn())
    monitor.start()
    await serveVersion(webSocketDebuggerUrl)

    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2), { timeout: 2500 })
    expect(WebSocket).not.toHaveBeenCalled()
    expect(monitor.getAttachedTargetIds()).toEqual([])
  })
})
