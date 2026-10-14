import { EventEmitter } from 'node:events'

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

  beforeEach(() => {
    workerMocks.createWorker.mockReset()
    workerMocks.instances.length = 0
    workerMocks.createWorker.mockImplementation((options) => {
      const worker = new FakeWorker(options)
      workerMocks.instances.push(worker)
      return worker
    })
    service = new ReadableContentService()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('holds the queue slot until the worker has terminated', async () => {
    const tasks = Array.from({ length: 4 }, (_, index) =>
      service.extractReadableMarkdown(`<article>${index}</article>`)
    )
    const firstTermination = deferred<number>()
    const firstWorker = workerMocks.instances[0]
    firstWorker.terminate.mockReturnValue(firstTermination.promise)

    expect(workerMocks.instances).toHaveLength(3)

    emitResult(firstWorker, 'first')
    await flushPromises()

    expect(workerMocks.instances).toHaveLength(3)

    firstTermination.resolve(0)
    await expect(tasks[0]).resolves.toEqual({ title: '', content: 'first' })
    await vi.waitFor(() => expect(workerMocks.instances).toHaveLength(4))

    workerMocks.instances.slice(1).forEach((worker, index) => emitResult(worker, `remaining-${index}`))
    await Promise.all(tasks.slice(1))
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

  it('rejects the caller promptly but holds the queue task until an aborted worker terminates', async () => {
    const controller = new AbortController()
    const abortError = Object.assign(new Error('panel closed'), { name: 'AbortError' })
    const extraction = service.extractReadableMarkdown('<article></article>', { signal: controller.signal })
    const worker = workerMocks.instances[0]
    const termination = deferred<number>()
    worker.terminate.mockReturnValue(termination.promise)

    controller.abort(abortError)

    await expect(extraction).rejects.toBe(abortError)
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(worker.listenerCount('message')).toBe(0)
    expect(worker.listenerCount('error')).toBe(0)
    expect(worker.listenerCount('exit')).toBe(0)

    termination.resolve(0)
    await flushPromises()
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

  it('preserves the worker result when termination fails', async () => {
    const extraction = service.extractReadableMarkdown('<article></article>')
    const worker = workerMocks.instances[0]
    worker.terminate.mockRejectedValue(new Error('terminate failed'))

    emitResult(worker, 'markdown')

    await expect(extraction).resolves.toEqual({ title: '', content: 'markdown' })
    expect(worker.terminate).toHaveBeenCalledOnce()
  })
})
