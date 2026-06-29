import { EventEmitter } from 'node:events'

import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { InferenceModelSource } from '../inferenceProtocol'

/**
 * A stand-in for the real `worker_threads` Worker: captures the lifecycle event
 * handlers InferenceHost registers (`message`/`error`/`exit`) and lets the test
 * drive them, so we can exercise the exit/failAll logic without a real worker.
 */
class FakeWorker extends EventEmitter {
  postMessage = vi.fn()
  unref = vi.fn()
  terminate = vi.fn(async () => 0)
}

const fakeWorkers: FakeWorker[] = []

vi.mock('node:worker_threads', () => ({
  Worker: vi.fn(() => {
    const worker = new FakeWorker()
    fakeWorkers.push(worker)
    return worker
  })
}))

// Import the SUT after the worker mock is declared (it constructs a Worker lazily on first send).
const { inferenceHost } = await import('../InferenceHost')

const SOURCE: InferenceModelSource = {
  remoteHost: 'https://huggingface.co',
  remotePathTemplate: '{model}/resolve/{revision}',
  revision: 'main'
}

/** The id InferenceHost stamped onto the embed request (the init message carries none). */
function lastRequestId(worker: FakeWorker): string {
  const call = worker.postMessage.mock.calls.find(([msg]) => (msg as { id?: string }).id !== undefined)
  return (call![0] as { id: string }).id
}

describe('InferenceHost worker exit / failAll', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fakeWorkers.length = 0
  })

  // Each test ends with the worker nulled (via exit or terminate), so the singleton is clean.
  afterEach(() => {
    inferenceHost.terminate()
  })

  it('rejects in-flight requests when the worker exits cleanly (code 0) instead of hanging forever', async () => {
    const pending = inferenceHost.embed(['hi'], SOURCE, 'org/model', 'q8')
    const worker = fakeWorkers.at(-1)!

    worker.emit('exit', 0)

    await expect(pending).rejects.toThrow(/exited unexpectedly \(code 0\)/)
    // failAll logs once for the in-flight rejection; a clean exit is not "abnormal".
    expect(mockMainLoggerService.error).toHaveBeenCalledTimes(1)
  })

  it('logs an abnormal (non-zero) exit even when no request is in flight (idle crash visibility)', async () => {
    const pending = inferenceHost.embed(['hi'], SOURCE, 'org/model', 'q8')
    const worker = fakeWorkers.at(-1)!

    // Settle the request so the worker goes idle (pending empty) before it crashes.
    worker.emit('message', { type: 'result', id: lastRequestId(worker), embeddings: [[0.1, 0.2]] })
    await pending

    worker.emit('exit', 1)

    // The non-zero exit must still be logged, otherwise the auto-respawn is silent.
    expect(mockMainLoggerService.error).toHaveBeenCalledWith('inference worker exited abnormally', expect.any(Error))
  })

  it('does not double-report when terminate() is followed by the worker exit event', async () => {
    const pending = inferenceHost.embed(['hi'], SOURCE, 'org/model', 'q8')
    const worker = fakeWorkers.at(-1)!

    inferenceHost.terminate()
    await expect(pending).rejects.toThrow(/terminated/)
    const afterTerminate = mockMainLoggerService.error.mock.calls.length

    // The terminated worker eventually emits exit; failAll no-ops (pending already cleared).
    worker.emit('exit', 0)

    expect(mockMainLoggerService.error.mock.calls.length).toBe(afterTerminate)
  })
})
