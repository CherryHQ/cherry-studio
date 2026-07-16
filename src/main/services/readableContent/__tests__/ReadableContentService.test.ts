import { EventEmitter, getEventListeners } from 'node:events'

import { BaseService, Phase } from '@main/core/lifecycle'
import { getPhase, getServiceName } from '@main/core/lifecycle/decorators'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type WorkerData = {
  readonly format: 'markdown' | 'preview'
  readonly inputKind: 'html' | 'text'
  readonly maxLength?: number
  readonly source: string
}

class FakeWorker extends EventEmitter {
  readonly terminate = vi.fn<() => Promise<number>>(() => Promise.resolve(0))
  readonly unref = vi.fn()

  constructor(readonly options: { workerData: WorkerData }) {
    super()
  }
}

const workerMocks = vi.hoisted(() => ({
  createWorker: vi.fn<(options: { workerData: WorkerData }) => FakeWorker>(),
  instances: [] as FakeWorker[]
}))

vi.mock('../readableContentWorker?nodeWorker', () => ({ default: workerMocks.createWorker }))

import { ReadableContentService } from '../ReadableContentService'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function emitResult(worker: FakeWorker, content = 'content', title = ''): void {
  worker.emit('message', { type: 'result', title, content })
}

describe('ReadableContentService', () => {
  let service: ReadableContentService

  beforeEach(async () => {
    BaseService.resetInstances()
    workerMocks.createWorker.mockReset()
    workerMocks.instances.length = 0
    workerMocks.createWorker.mockImplementation((options) => {
      const worker = new FakeWorker(options)
      workerMocks.instances.push(worker)
      return worker
    })
    service = new ReadableContentService()
    await service._doInit()
  })

  afterEach(async () => {
    vi.useRealTimers()
    if (!service.isStopped && !service.isDestroyed) {
      await service._doStop()
    }
    BaseService.resetInstances()
  })

  it('is a WhenReady lifecycle service', () => {
    expect(getServiceName(ReadableContentService)).toBe('ReadableContentService')
    expect(getPhase(ReadableContentService)).toBe(Phase.WhenReady)
  })

  it('runs three workers concurrently and delays the fourth task', async () => {
    const tasks = Array.from({ length: 4 }, (_, index) =>
      service.extractReadableMarkdown(`<article>${index}</article>`)
    )

    expect(workerMocks.instances).toHaveLength(3)

    emitResult(workerMocks.instances[0], 'first')
    await expect(tasks[0]).resolves.toEqual({ title: '', content: 'first' })
    await vi.waitFor(() => expect(workerMocks.instances).toHaveLength(4))

    workerMocks.instances.slice(1).forEach((worker, index) => emitResult(worker, `remaining-${index}`))
    await Promise.all(tasks.slice(1))
  })

  it('does not accumulate abort listeners on the lifecycle signal after successful tasks', async () => {
    const shutdownSignal = (service as unknown as { shutdownController: AbortController }).shutdownController.signal

    for (let index = 0; index < 5; index += 1) {
      const extraction = service.extractReadableMarkdown(`<article>${index}</article>`)
      emitResult(workerMocks.instances.at(-1)!, `result-${index}`)
      await extraction
    }

    expect(getEventListeners(shutdownSignal, 'abort')).toHaveLength(0)
  })

  it('does not spawn a worker when a queued task is aborted', async () => {
    const active = Array.from({ length: 3 }, () => service.extractReadableMarkdown('<article>active</article>'))
    const controller = new AbortController()
    const abortError = Object.assign(new Error('no longer needed'), { name: 'AbortError' })
    const queued = service.extractReadableMarkdown('<article>queued</article>', { signal: controller.signal })

    expect(workerMocks.instances).toHaveLength(3)
    controller.abort(abortError)

    await expect(queued).rejects.toBe(abortError)
    expect(workerMocks.instances).toHaveLength(3)

    for (const [index, worker] of workerMocks.instances.entries()) {
      expect(worker.listenerCount('message')).toBe(1)
      emitResult(worker, `active-${index}`)
      await expect(active[index]).resolves.toEqual({ title: '', content: `active-${index}` })
    }
  })

  it('terminates once and preserves the caller reason when an active task is aborted', async () => {
    const controller = new AbortController()
    const abortError = Object.assign(new Error('panel closed'), { name: 'AbortError' })
    const extraction = service.extractReadableMarkdown('<article></article>', { signal: controller.signal })
    const worker = workerMocks.instances[0]

    const assertion = expect(extraction).rejects.toBe(abortError)
    controller.abort(abortError)
    worker.emit('exit', 99)

    await assertion
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(worker.listenerCount('message')).toBe(0)
    expect(worker.listenerCount('error')).toBe(0)
    expect(worker.listenerCount('exit')).toBe(0)
  })

  it('terminates once and rejects with TimeoutError when parsing times out', async () => {
    vi.useFakeTimers()
    const extraction = service.extractReadableMarkdown('<article></article>', { timeoutMs: 25 })
    const worker = workerMocks.instances[0]

    const assertion = expect(extraction).rejects.toMatchObject({
      name: 'TimeoutError',
      message: 'Readable content extraction timed out after 25ms'
    })
    await vi.advanceTimersByTimeAsync(25)

    await assertion
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it.each([
    {
      name: 'result',
      emit: (worker: FakeWorker) => emitResult(worker, 'markdown', 'Article'),
      assert: (extraction: Promise<unknown>) =>
        expect(extraction).resolves.toEqual({ title: 'Article', content: 'markdown' })
    },
    {
      name: 'worker message error',
      emit: (worker: FakeWorker) => worker.emit('message', { type: 'error', message: 'parse failed' }),
      assert: (extraction: Promise<unknown>) => expect(extraction).rejects.toThrow('parse failed')
    },
    {
      name: 'worker error event',
      emit: (worker: FakeWorker) => worker.emit('error', new Error('worker crashed')),
      assert: (extraction: Promise<unknown>) => expect(extraction).rejects.toThrow('worker crashed')
    },
    {
      name: 'worker exit',
      emit: (worker: FakeWorker) => worker.emit('exit', 2),
      assert: (extraction: Promise<unknown>) =>
        expect(extraction).rejects.toThrow('Readable content worker exited before responding (code 2)')
    }
  ])('settles and terminates once after $name', async ({ emit, assert }) => {
    const extraction = service.extractReadableMarkdown('<article></article>')
    const worker = workerMocks.instances[0]

    emit(worker)
    worker.emit('exit', 99)

    await assert(extraction)
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(worker.unref).toHaveBeenCalledOnce()
    expect(worker.listenerCount('message')).toBe(0)
    expect(worker.listenerCount('error')).toBe(0)
    expect(worker.listenerCount('exit')).toBe(0)
  })

  it('passes preview input to the worker without exposing a plain-text format', async () => {
    const extraction = service.extractPreviewText('plain source', { inputKind: 'text', maxLength: 100 })
    const worker = workerMocks.instances[0]

    expect(worker.options).toEqual({
      workerData: {
        format: 'preview',
        inputKind: 'text',
        maxLength: 100,
        source: 'plain source'
      }
    })

    emitResult(worker, 'preview')
    await expect(extraction).resolves.toBe('preview')
  })

  it('starts the bundled worker without runtime module paths', async () => {
    const extraction = service.extractReadableMarkdown('<article></article>')
    const worker = workerMocks.instances[0]

    expect(workerMocks.createWorker).toHaveBeenCalledWith({
      workerData: { format: 'markdown', inputKind: 'html', source: '<article></article>' }
    })
    expect(worker.options).not.toHaveProperty('eval')
    expect(worker.options.workerData).not.toHaveProperty('jsdomModulePath')
    expect(worker.options.workerData).not.toHaveProperty('readabilityModulePath')
    expect(worker.options.workerData).not.toHaveProperty('turndownModulePath')

    emitResult(worker, 'markdown')
    await extraction
  })

  it('aborts queued and active tasks during stop, prevents respawn, and waits for termination', async () => {
    const tasks = Array.from({ length: 4 }, () => service.extractReadableMarkdown('<article></article>'))
    const terminations = workerMocks.instances.map(() => deferred<number>())
    workerMocks.instances.forEach((worker, index) => {
      worker.terminate.mockImplementation(() => terminations[index].promise)
    })
    const settledTasks = Promise.allSettled(tasks)
    let stopSettled = false

    const stop = service._doStop().then(() => {
      stopSettled = true
    })
    await flushPromises()

    expect(workerMocks.instances).toHaveLength(3)
    expect(workerMocks.instances.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(true)
    expect(stopSettled).toBe(false)

    terminations.forEach((termination) => termination.resolve(0))
    await stop
    const results = await settledTasks

    expect(results.every((result) => result.status === 'rejected')).toBe(true)
    expect(stopSettled).toBe(true)
  })

  it('rejects after stop and accepts tasks again after re-initialization', async () => {
    await service._doStop()

    await expect(service.extractReadableMarkdown('<article>stopped</article>')).rejects.toThrow(
      'ReadableContentService is not initialized'
    )
    expect(workerMocks.instances).toHaveLength(0)

    await service._doInit()
    const extraction = service.extractReadableMarkdown('<article>restarted</article>')
    const worker = workerMocks.instances[0]
    emitResult(worker, 'restarted')

    await expect(extraction).resolves.toEqual({ title: '', content: 'restarted' })
  })

  it('keeps stop idempotent when destroy follows it and swallows terminate failures', async () => {
    const extraction = service.extractReadableMarkdown('<article></article>')
    const worker = workerMocks.instances[0]
    worker.terminate.mockRejectedValue(new Error('terminate failed'))
    const settledExtraction = extraction.catch(() => undefined)

    await expect(service._doStop()).resolves.toBeUndefined()
    await expect(service._doDestroy()).resolves.toBeUndefined()
    await settledExtraction

    expect(worker.terminate).toHaveBeenCalledOnce()
  })
})
