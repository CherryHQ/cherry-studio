import type * as EventsModule from 'node:events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type MockWorkerInstance = {
  emit: (eventName: string, ...args: unknown[]) => boolean
  terminate: ReturnType<typeof vi.fn>
}

const workerMocks = vi.hoisted(() => ({ instances: [] as MockWorkerInstance[] }))

vi.mock('node:worker_threads', async () => {
  const { EventEmitter } = await vi.importActual<typeof EventsModule>('node:events')

  return {
    Worker: class extends EventEmitter {
      readonly removeAllListeners = vi.fn(() => super.removeAllListeners())
      readonly terminate = vi.fn(async () => 1)
      readonly unref = vi.fn()

      constructor() {
        super()
        workerMocks.instances.push(this)
      }
    }
  }
})

import { extractReadableText } from '../readableContent'

describe('readableContent worker lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    workerMocks.instances.length = 0
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('terminates the worker and rejects when parsing exceeds its own timeout', async () => {
    const extraction = extractReadableText('<html></html>', { timeoutMs: 25 })
    const worker = workerMocks.instances[0]

    const assertion = expect(extraction).rejects.toMatchObject({ name: 'TimeoutError' })
    await vi.advanceTimersByTimeAsync(25)

    await assertion
    expect(worker?.terminate).toHaveBeenCalledOnce()
  })

  it('terminates the worker and preserves the caller abort reason', async () => {
    const controller = new AbortController()
    const abortError = Object.assign(new Error('panel closed'), { name: 'AbortError' })
    const extraction = extractReadableText('<html></html>', { signal: controller.signal })
    const worker = workerMocks.instances[0]

    const assertion = expect(extraction).rejects.toBe(abortError)
    controller.abort(abortError)

    await assertion
    expect(worker?.terminate).toHaveBeenCalledOnce()
  })

  it('terminates the worker after receiving a result', async () => {
    const extraction = extractReadableText('<html></html>')
    const worker = workerMocks.instances[0]

    worker?.emit('message', { type: 'result', title: '', content: 'preview' })

    await expect(extraction).resolves.toBe('preview')
    expect(worker?.terminate).toHaveBeenCalledOnce()
  })
})
