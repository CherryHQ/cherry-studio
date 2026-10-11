import { EventEmitter } from 'node:events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'

import { RemoteDebuggingMonitor } from '../RemoteDebuggingMonitor'

vi.mock('ws', () => ({ default: vi.fn() }))

describe('RemoteDebuggingMonitor endpoint validation', () => {
  let monitor: RemoteDebuggingMonitor
  let socket: EventEmitter & { send: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    socket = Object.assign(new EventEmitter(), { send: vi.fn(), terminate: vi.fn() })
    vi.mocked(WebSocket)
      .mockReset()
      .mockImplementation(function () {
        return socket as unknown as WebSocket
      })
  })

  afterEach(() => {
    monitor.stop()
    vi.unstubAllGlobals()
  })

  it.each(['ws://127.0.0.1:80/devtools/browser/test', 'ws://127.0.0.1/devtools/browser/test'])(
    'observes attachments on port 80 advertised as %s',
    async (webSocketDebuggerUrl) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ webSocketDebuggerUrl }) }))
      monitor = new RemoteDebuggingMonitor(async () => 80, vi.fn())
      monitor.start()

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
})
