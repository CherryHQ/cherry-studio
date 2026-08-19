import { beforeEach, describe, expect, it, vi } from 'vitest'

import { pyodideService } from '../PyodideService'

interface FakeWorkerInstance {
  posted: any[]
  terminated: boolean
  emit: (data: any) => void
}

const workerMocks = vi.hoisted(() => ({
  instances: [] as any[]
}))

vi.mock('../../workers/pyodide.worker?worker', () => ({
  default: class FakePyodideWorker {
    onmessage: ((event: MessageEvent) => void) | null = null
    listeners = new Set<(event: MessageEvent) => void>()
    posted: any[] = []
    terminated = false

    constructor() {
      workerMocks.instances.push(this)
      queueMicrotask(() => this.emit({ type: 'initialized' }))
    }

    addEventListener(_type: string, listener: (event: MessageEvent) => void) {
      this.listeners.add(listener)
    }

    removeEventListener(_type: string, listener: (event: MessageEvent) => void) {
      this.listeners.delete(listener)
    }

    postMessage(message: any) {
      this.posted.push(message)
    }

    terminate() {
      this.terminated = true
    }

    emit(data: any) {
      const event = { data } as MessageEvent
      this.onmessage?.(event)
      for (const listener of [...this.listeners]) {
        listener(event)
      }
    }
  }
}))

const latestWorker = (): FakeWorkerInstance => workerMocks.instances.at(-1)

const outputWithText = (text: string) => ({ result: null, text: `${text}\n`, error: null })

describe('PyodideService', () => {
  beforeEach(() => {
    workerMocks.instances.length = 0
    pyodideService.terminate()
  })

  it('should run scripts serially so outputs cannot interleave', async () => {
    const first = pyodideService.runScript('print("one")')
    const second = pyodideService.runScript('print("two")')

    await vi.waitFor(() => expect(latestWorker()?.posted).toHaveLength(1))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(latestWorker().posted).toHaveLength(1)

    const worker = latestWorker()
    worker.emit({ id: worker.posted[0].id, output: outputWithText('one') })
    await expect(first).resolves.toEqual({ text: 'one' })

    await vi.waitFor(() => expect(worker.posted).toHaveLength(2))
    worker.emit({ id: worker.posted[1].id, output: outputWithText('two') })
    await expect(second).resolves.toEqual({ text: 'two' })
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

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(worker.posted).toHaveLength(1)
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
})
