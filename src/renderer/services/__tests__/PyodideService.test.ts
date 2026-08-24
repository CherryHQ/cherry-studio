import { IpcChannel } from '@shared/IpcChannel'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { pyodideService } from '../PyodideService'

interface FakeWorkerInstance {
  posted: any[]
  terminated: boolean
  overlapped: boolean
  emit: (data: any) => void
}

const workerMocks = vi.hoisted(() => ({
  instances: [] as any[],
  holdInit: false
}))

vi.mock('../../workers/pyodide.worker?worker', () => ({
  default: class FakePyodideWorker {
    onmessage: ((event: MessageEvent) => void) | null = null
    listeners = new Set<(event: MessageEvent) => void>()
    posted: any[] = []
    outstanding = new Set<string>()
    overlapped = false
    terminated = false

    constructor() {
      workerMocks.instances.push(this)
      if (!workerMocks.holdInit) {
        queueMicrotask(() => this.emit({ type: 'initialized' }))
      }
    }

    addEventListener(_type: string, listener: (event: MessageEvent) => void) {
      this.listeners.add(listener)
    }

    removeEventListener(_type: string, listener: (event: MessageEvent) => void) {
      this.listeners.delete(listener)
    }

    postMessage(message: any) {
      // Pyodide 在 worker 线程同步执行且共享输出缓冲，收到第二个请求时前一个必须已经回复
      if (this.outstanding.size > 0) {
        this.overlapped = true
      }
      this.outstanding.add(message.id)
      this.posted.push(message)
    }

    terminate() {
      this.terminated = true
      this.outstanding.clear()
    }

    emit(data: any) {
      if (data?.id) {
        this.outstanding.delete(data.id)
      }
      const event = { data } as MessageEvent
      this.onmessage?.(event)
      for (const listener of [...this.listeners]) {
        listener(event)
      }
    }
  }
}))

const latestWorker = (): FakeWorkerInstance => workerMocks.instances.at(-1)

const scriptsSentTo = (worker: FakeWorkerInstance) => worker.posted.map((message) => message.python)

const outputWithText = (text: string) => ({ result: null, text: `${text}\n`, error: null })

type IpcListener = (event: unknown, ...args: any[]) => any

const ipcRendererSpy = (method: 'on' | 'send') =>
  window.electron.ipcRenderer[method] as unknown as ReturnType<typeof vi.fn>

const ipcListener = (channel: IpcChannel): IpcListener => {
  const call = ipcRendererSpy('on').mock.calls.find((args) => args[0] === channel)
  if (!call) {
    throw new Error(`PyodideService registered no listener for ${channel}`)
  }
  return call[1] as IpcListener
}

describe('PyodideService', () => {
  beforeEach(() => {
    workerMocks.instances.length = 0
    workerMocks.holdInit = false
    pyodideService.terminate()
  })

  it('should run scripts serially so outputs cannot interleave', async () => {
    const first = pyodideService.runScript('print("one")')
    const second = pyodideService.runScript('print("two")')

    await vi.waitFor(() => expect(latestWorker()?.posted).toHaveLength(1))
    const worker = latestWorker()
    expect(scriptsSentTo(worker)).toEqual(['print("one")'])

    worker.emit({ id: worker.posted[0].id, output: outputWithText('one') })
    await expect(first).resolves.toEqual({ text: 'one' })

    await vi.waitFor(() => expect(worker.posted).toHaveLength(2))
    worker.emit({ id: worker.posted[1].id, output: outputWithText('two') })
    await expect(second).resolves.toEqual({ text: 'two' })

    expect(worker.overlapped).toBe(false)
  })

  it('should skip a cancelled queued run without sending it to the worker', async () => {
    const controller = new AbortController()
    const first = pyodideService.runScript('print("busy")')
    const queued = pyodideService.runScript('print("queued")', {}, 60000, controller.signal)

    await vi.waitFor(() => expect(latestWorker()?.posted).toHaveLength(1))
    controller.abort()

    const worker = latestWorker()
    worker.emit({ id: worker.posted[0].id, output: outputWithText('busy') })
    await expect(first).resolves.toEqual({ text: 'busy' })
    await expect(queued).resolves.toEqual({ text: 'Python execution cancelled' })

    expect(scriptsSentTo(worker)).toEqual(['print("busy")'])
  })

  it('should not reach the worker when cancelled during initialization', async () => {
    workerMocks.holdInit = true
    const controller = new AbortController()
    const run = pyodideService.runScript('print("late")', {}, 60000, controller.signal)

    await vi.waitFor(() => expect(workerMocks.instances).toHaveLength(1))
    controller.abort()
    latestWorker().emit({ type: 'initialized' })

    await expect(run).resolves.toEqual({ text: 'Python execution cancelled' })
    expect(scriptsSentTo(latestWorker())).toEqual([])
  })

  it('should terminate the worker when the running script is cancelled', async () => {
    const controller = new AbortController()
    const running = pyodideService.runScript('while True: pass', {}, 60000, controller.signal)

    await vi.waitFor(() => expect(workerMocks.instances[0]?.posted).toHaveLength(1))
    const stuckWorker: FakeWorkerInstance = workerMocks.instances[0]
    controller.abort()

    await expect(running).resolves.toEqual({ text: 'Internal error: Python execution cancelled' })
    expect(stuckWorker.terminated).toBe(true)
  })

  it('should terminate the worker on timeout and rebuild it for queued runs', async () => {
    const stuck = pyodideService.runScript('while True: pass', {}, 30)
    const queued = pyodideService.runScript('print("after")')

    await vi.waitFor(() => expect(workerMocks.instances[0]?.posted).toHaveLength(1))
    const stuckWorker: FakeWorkerInstance = workerMocks.instances[0]

    await expect(stuck).resolves.toEqual({ text: 'Internal error: Python execution timed out' })
    expect(stuckWorker.terminated).toBe(true)

    await vi.waitFor(() => expect(workerMocks.instances).toHaveLength(2))
    const freshWorker = latestWorker()
    await vi.waitFor(() => expect(freshWorker.posted).toHaveLength(1))
    freshWorker.emit({ id: freshWorker.posted[0].id, output: outputWithText('after') })
    await expect(queued).resolves.toEqual({ text: 'after' })
  })

  describe('main-process bridge', () => {
    it('should answer a main-process execution request with the formatted output', async () => {
      const send = ipcRendererSpy('send')
      send.mockClear()

      const handled = ipcListener(IpcChannel.Python_ExecutionRequest)(null, {
        id: 'request-1',
        script: 'print("ipc")',
        context: {},
        timeout: 60000
      })

      await vi.waitFor(() => expect(latestWorker()?.posted).toHaveLength(1))
      const worker = latestWorker()
      worker.emit({ id: worker.posted[0].id, output: outputWithText('ipc') })
      await handled

      expect(send).toHaveBeenCalledWith(IpcChannel.Python_ExecutionResponse, {
        id: 'request-1',
        result: 'ipc'
      })
    })

    it('should drop a queued main-process request when main broadcasts a cancel', async () => {
      const send = ipcRendererSpy('send')
      send.mockClear()

      const busy = pyodideService.runScript('print("busy")')
      const handled = ipcListener(IpcChannel.Python_ExecutionRequest)(null, {
        id: 'request-2',
        script: 'print("queued")',
        context: {},
        timeout: 60000
      })

      await vi.waitFor(() => expect(latestWorker()?.posted).toHaveLength(1))
      ipcListener(IpcChannel.Python_ExecutionCancel)(null, 'request-2')

      const worker = latestWorker()
      worker.emit({ id: worker.posted[0].id, output: outputWithText('busy') })
      await expect(busy).resolves.toEqual({ text: 'busy' })
      await handled

      expect(scriptsSentTo(worker)).toEqual(['print("busy")'])
      expect(send).toHaveBeenCalledWith(IpcChannel.Python_ExecutionResponse, {
        id: 'request-2',
        result: 'Python execution cancelled'
      })
    })
  })
})
