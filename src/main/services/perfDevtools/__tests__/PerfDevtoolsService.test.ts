import { EventEmitter } from 'node:events'

import { BaseService } from '@main/core/lifecycle'
import { PerfRecorder } from '@main/core/perf'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() })
  }
}))

vi.mock('electron', () => ({
  app: {
    getAppMetrics: vi.fn(() => []),
    isReady: vi.fn(() => true),
    on: vi.fn(),
    removeListener: vi.fn(),
    whenReady: vi.fn(() => Promise.resolve())
  }
}))

vi.mock('@main/core/devtools', () => ({ installBundledDevtools: vi.fn() }))

import { PerfDevtoolsService } from '../PerfDevtoolsService'

/** 最小 WebSocket 替身：记录发出的帧，并能模拟面板发来的消息。 */
class FakeSocket extends EventEmitter {
  readyState = 1
  sent: string[] = []
  closedWith: number | null = null

  send(payload: string) {
    this.sent.push(payload)
  }

  close(code?: number) {
    this.closedWith = code ?? 1000
  }

  frames(): Array<Record<string, unknown>> {
    return this.sent.map((raw) => JSON.parse(raw))
  }
}

/** 触达服务内部的连接处理，避免真的开端口。 */
interface ServiceInternals {
  handleConnection(socket: FakeSocket, origin: string | undefined): void
  registerOrigin(origin: string): void
}

function createService(recorder: PerfRecorder) {
  const service = new PerfDevtoolsService(recorder)
  // onInit 会开端口，这里只订阅 span 流，等价于 onInit 里那一句。
  recorder.onSpan((span) => (service as unknown as { broadcast(m: unknown): void }).broadcast({ type: 'span', span }))
  return service as unknown as ServiceInternals
}

function tickingRecorder() {
  let time = 0
  return new PerfRecorder({ enabled: true, now: () => (time += 10) })
}

describe('PerfDevtoolsService websocket protocol', () => {
  let recorder: PerfRecorder

  beforeEach(() => {
    BaseService.resetInstances()
    recorder = tickingRecorder()
  })

  afterEach(() => {
    BaseService.resetInstances()
    vi.clearAllMocks()
  })

  it('rejects a connection whose origin was never installed', () => {
    const service = createService(recorder)
    const socket = new FakeSocket()

    service.handleConnection(socket, 'chrome-extension://someone-else')

    expect(socket.closedWith).toBe(1008)
    expect(socket.sent).toEqual([])
  })

  it('rejects a connection carrying no origin at all', () => {
    const service = createService(recorder)
    const socket = new FakeSocket()

    service.handleConnection(socket, undefined)

    expect(socket.closedWith).toBe(1008)
  })

  it('sends the full snapshot to an allowed origin on connect', () => {
    recorder.start('DbService.init', { track: 'bootstrap' }).end()
    const service = createService(recorder)
    service.registerOrigin('chrome-extension://abc')
    const socket = new FakeSocket()

    service.handleConnection(socket, 'chrome-extension://abc')

    const [frame] = socket.frames()
    expect(frame.type).toBe('snapshot')
    expect(frame.spans).toHaveLength(1)
    expect(frame).toHaveProperty('memory')
    expect(frame).toHaveProperty('processes')
  })

  it('streams each newly completed span to connected panels', () => {
    const service = createService(recorder)
    service.registerOrigin('chrome-extension://abc')
    const socket = new FakeSocket()
    service.handleConnection(socket, 'chrome-extension://abc')
    socket.sent.length = 0

    recorder.start('window.minimize', { track: 'ipc' }).end()

    expect(socket.frames()).toEqual([
      { type: 'span', span: expect.objectContaining({ name: 'window.minimize', track: 'ipc' }) }
    ])
  })

  it('clears the recorder and tells every panel when a panel asks to clear', () => {
    recorder.start('stale').end()
    const service = createService(recorder)
    service.registerOrigin('chrome-extension://abc')
    const socket = new FakeSocket()
    service.handleConnection(socket, 'chrome-extension://abc')
    socket.sent.length = 0

    socket.emit('message', Buffer.from(JSON.stringify({ type: 'clear' })))

    expect(recorder.snapshot()).toEqual([])
    expect(socket.frames()).toEqual([{ type: 'cleared' }])
  })

  it('answers a metrics request on demand', () => {
    const service = createService(recorder)
    service.registerOrigin('chrome-extension://abc')
    const socket = new FakeSocket()
    service.handleConnection(socket, 'chrome-extension://abc')
    socket.sent.length = 0

    socket.emit('message', Buffer.from(JSON.stringify({ type: 'metrics' })))

    expect(socket.frames()).toEqual([{ type: 'metrics', processes: [] }])
  })

  it('ignores a malformed frame instead of throwing', () => {
    const service = createService(recorder)
    service.registerOrigin('chrome-extension://abc')
    const socket = new FakeSocket()
    service.handleConnection(socket, 'chrome-extension://abc')

    expect(() => socket.emit('message', Buffer.from('not json'))).not.toThrow()
  })

  it('stops streaming to a socket after it closes', () => {
    const service = createService(recorder)
    service.registerOrigin('chrome-extension://abc')
    const socket = new FakeSocket()
    service.handleConnection(socket, 'chrome-extension://abc')
    socket.sent.length = 0
    socket.emit('close')

    recorder.start('after-close').end()

    expect(socket.sent).toEqual([])
  })

  it('keeps serving other panels after one of them errors out', () => {
    const service = createService(recorder)
    service.registerOrigin('chrome-extension://abc')
    const broken = new FakeSocket()
    const healthy = new FakeSocket()
    service.handleConnection(broken, 'chrome-extension://abc')
    service.handleConnection(healthy, 'chrome-extension://abc')
    broken.sent.length = 0
    healthy.sent.length = 0
    broken.emit('error', new Error('socket died'))

    recorder.start('after-error').end()

    expect(broken.sent).toEqual([])
    expect(healthy.frames()).toHaveLength(1)
  })
})
