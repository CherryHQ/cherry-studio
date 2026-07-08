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

// Pin to a supported platform so this suite is deterministic regardless of the
// machine it runs on (see InferenceHost.darwinX64.test.ts for the gate itself).
vi.mock('@main/core/platform', () => ({ isDarwinX64: false }))

// Import the SUT after the worker mock is declared (it constructs a Worker lazily on first send).
const { EmbeddingInferenceHost, OcrInferenceHost } = await import('../InferenceHost')
const embeddingInferenceHost = new EmbeddingInferenceHost()
const ocrInferenceHost = new OcrInferenceHost()

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

/** The id stamped onto the most recently posted request (for a worker that already
 * skipped its one-time init message, i.e. a second+ request on the same worker). */
function lastPostedId(worker: FakeWorker): string {
  const [msg] = worker.postMessage.mock.calls.at(-1)!
  return (msg as { id: string }).id
}

describe('InferenceHost worker exit / failAll', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fakeWorkers.length = 0
  })

  // Each test ends with the worker nulled (via exit or terminate), so the singleton is clean.
  afterEach(async () => {
    await embeddingInferenceHost.terminate()
  })

  it('rejects in-flight requests when the worker exits cleanly (code 0) instead of hanging forever', async () => {
    const pending = embeddingInferenceHost.embed(['hi'], SOURCE, 'org/model', 'q8')
    const worker = fakeWorkers.at(-1)!

    worker.emit('exit', 0)

    await expect(pending).rejects.toThrow(/exited unexpectedly \(code 0\)/)
    // failAll logs once for the in-flight rejection; a clean exit is not "abnormal".
    expect(mockMainLoggerService.error).toHaveBeenCalledTimes(1)
  })

  it('logs an abnormal (non-zero) exit even when no request is in flight (idle crash visibility)', async () => {
    const pending = embeddingInferenceHost.embed(['hi'], SOURCE, 'org/model', 'q8')
    const worker = fakeWorkers.at(-1)!

    // Settle the request so the worker goes idle (pending empty) before it crashes.
    worker.emit('message', { type: 'result', id: lastRequestId(worker), embeddings: [[0.1, 0.2]] })
    await pending

    worker.emit('exit', 1)

    // The non-zero exit must still be logged, otherwise the auto-respawn is silent.
    expect(mockMainLoggerService.error).toHaveBeenCalledWith('inference worker exited abnormally', expect.any(Error))
  })

  it('does not double-report when terminate() is followed by the worker exit event', async () => {
    const pending = embeddingInferenceHost.embed(['hi'], SOURCE, 'org/model', 'q8')
    const worker = fakeWorkers.at(-1)!

    await embeddingInferenceHost.terminate()
    await expect(pending).rejects.toThrow(/terminated/)
    const afterTerminate = mockMainLoggerService.error.mock.calls.length

    // The terminated worker eventually emits exit; failAll no-ops (pending already cleared).
    worker.emit('exit', 0)

    expect(mockMainLoggerService.error.mock.calls.length).toBe(afterTerminate)
  })

  it('terminate() resolves only once the worker has actually exited, not just been asked to', async () => {
    // terminate() rejects this in-flight request synchronously — swallow it here, but still
    // await it below so the shared queue's concurrency slot is fully released before the
    // test ends (concurrency: 1 means a lingering unsettled request blocks the next test).
    const rejected = embeddingInferenceHost.embed(['hi'], SOURCE, 'org/model', 'q8').catch(() => {})
    const worker = fakeWorkers.at(-1)!
    let releaseExit: (code: number) => void = () => {}
    worker.terminate.mockImplementation(() => new Promise<number>((resolve) => (releaseExit = resolve)))

    let settled = false
    const done = embeddingInferenceHost.terminate().then(() => {
      settled = true
    })

    // Pending requests reject immediately — that part doesn't wait on the real
    // OS-level exit — but terminate()'s own promise must still be pending: a
    // caller deleting on-disk weights right after (Windows file-lock release)
    // must not proceed before the thread has genuinely torn down.
    await Promise.resolve()
    await Promise.resolve()
    expect(settled).toBe(false)

    releaseExit(0)
    await done
    await rejected
    expect(settled).toBe(true)
  })

  it("ignores a superseded worker's late exit instead of tearing down the live worker", async () => {
    const stale = embeddingInferenceHost.embed(['a'], SOURCE, 'org/model', 'q8')
    const workerA = fakeWorkers.at(-1)!

    // Tear down A (rejecting its own in-flight), then start a fresh request → worker B.
    await embeddingInferenceHost.terminate()
    await expect(stale).rejects.toThrow(/terminated/)
    const live = embeddingInferenceHost.embed(['b'], SOURCE, 'org/model', 'q8')
    const workerB = fakeWorkers.at(-1)!
    expect(workerB).not.toBe(workerA)

    let liveRejected = false
    void live.catch(() => {
      liveRejected = true
    })

    // A's delayed exit must not clear B's reference or reject B's in-flight request.
    workerA.emit('exit', 1)
    await Promise.resolve()
    await Promise.resolve()

    expect(liveRejected).toBe(false)
    // Settle B's request (queue concurrency: 1 — the next request below stays queued
    // otherwise) before checking that reusing B spawns no third worker.
    workerB.emit('message', { type: 'result', id: lastRequestId(workerB), embeddings: [[0.1]] })
    await live

    const reused = embeddingInferenceHost.embed(['c'], SOURCE, 'org/model', 'q8')
    expect(fakeWorkers).toHaveLength(2)
    workerB.emit('message', { type: 'result', id: lastPostedId(workerB), embeddings: [[0.2]] })
    await reused
  })

  it("ignores a superseded worker's late error instead of rejecting the live worker's requests", async () => {
    const stale = embeddingInferenceHost.embed(['a'], SOURCE, 'org/model', 'q8')
    const workerA = fakeWorkers.at(-1)!

    await embeddingInferenceHost.terminate()
    await expect(stale).rejects.toThrow(/terminated/)
    const live = embeddingInferenceHost.embed(['b'], SOURCE, 'org/model', 'q8')
    const workerB = fakeWorkers.at(-1)!
    expect(workerB).not.toBe(workerA)

    let liveRejected = false
    void live.catch(() => {
      liveRejected = true
    })

    // A superseded worker's late `error` must not reject the live worker's in-flight request.
    workerA.emit('error', new Error('late error from A'))
    await Promise.resolve()
    await Promise.resolve()

    expect(liveRejected).toBe(false)
    // Settle B's request so the shared queue's concurrency slot is free for the next test.
    workerB.emit('message', { type: 'result', id: lastRequestId(workerB), embeddings: [[0.1]] })
    await live
  })
})

describe('embeddingInferenceHost / ocrInferenceHost isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fakeWorkers.length = 0
  })

  afterEach(async () => {
    await embeddingInferenceHost.terminate()
    await ocrInferenceHost.terminate()
  })

  it('terminating the embedding host does not touch an in-flight OCR request or its worker', async () => {
    const ocrPending = ocrInferenceHost.recognize(
      { detection: '/a', recognition: '/b', charactersDictionary: '/c' },
      '/img.png'
    )
    const ocrWorker = fakeWorkers.at(-1)!

    const embedRejected = embeddingInferenceHost.embed(['hi'], SOURCE, 'org/model', 'q8').catch(() => {})
    const embeddingWorker = fakeWorkers.at(-1)!
    expect(embeddingWorker).not.toBe(ocrWorker)

    await embeddingInferenceHost.terminate()
    // Release the shared queue's concurrency slot before the test ends.
    await embedRejected

    // The two hosts don't share a worker, a pending map, or a terminate() — killing
    // one must never collaterally kill or reject the other's in-flight request.
    expect(ocrWorker.terminate).not.toHaveBeenCalled()
    let ocrSettled = false
    void ocrPending.finally(() => {
      ocrSettled = true
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(ocrSettled).toBe(false)

    ocrWorker.emit('message', { type: 'result', id: lastRequestId(ocrWorker), text: 'ok' })
    await expect(ocrPending).resolves.toBe('ok')
  })
})

describe('InferenceHost idle-release timer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fakeWorkers.length = 0
  })

  afterEach(async () => {
    await embeddingInferenceHost.terminate()
    vi.useRealTimers()
  })

  it('releases the worker after an idle timeout', async () => {
    vi.useFakeTimers()

    const pending = embeddingInferenceHost.embed(['hi'], SOURCE, 'org/model', 'q8')
    const worker = fakeWorkers.at(-1)!
    worker.emit('message', { type: 'result', id: lastRequestId(worker), embeddings: [[0.1]] })
    await pending

    expect(worker.terminate).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(60_000)

    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })

  it('keeps the worker alive when another request arrives before the idle timeout', async () => {
    vi.useFakeTimers()

    const first = embeddingInferenceHost.embed(['hi'], SOURCE, 'org/model', 'q8')
    const worker = fakeWorkers.at(-1)!
    worker.emit('message', { type: 'result', id: lastRequestId(worker), embeddings: [[0.1]] })
    await first

    await vi.advanceTimersByTimeAsync(30_000)

    const second = embeddingInferenceHost.embed(['bye'], SOURCE, 'org/model', 'q8')
    worker.emit('message', { type: 'result', id: lastPostedId(worker), embeddings: [[0.2]] })
    await second

    await vi.advanceTimersByTimeAsync(59_000)

    // The second request rearmed the timer — still within its own 60s window.
    expect(fakeWorkers).toHaveLength(1)
    expect(worker.terminate).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1_000)

    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })
})

describe('InferenceHost request queue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fakeWorkers.length = 0
  })

  afterEach(async () => {
    await embeddingInferenceHost.terminate()
  })

  it('serializes concurrent requests so only one is in flight to the worker at a time', async () => {
    const first = embeddingInferenceHost.embed(['a'], SOURCE, 'org/model', 'q8')
    const worker = fakeWorkers.at(-1)!
    const second = embeddingInferenceHost.embed(['b'], SOURCE, 'org/model', 'q8')

    const postedRequestCount = () =>
      worker.postMessage.mock.calls.filter(([msg]) => (msg as { id?: string }).id !== undefined).length

    // The second request is queued — nothing has been posted for it yet.
    await Promise.resolve()
    await Promise.resolve()
    expect(postedRequestCount()).toBe(1)

    worker.emit('message', { type: 'result', id: lastRequestId(worker), embeddings: [[0.1]] })
    await first

    // Settling the first dispatches the second — still to the same (single) worker.
    expect(postedRequestCount()).toBe(2)
    expect(fakeWorkers).toHaveLength(1)

    worker.emit('message', { type: 'result', id: lastPostedId(worker), embeddings: [[0.2]] })
    await expect(second).resolves.toEqual([[0.2]])
  })

  it('rejects a queued request immediately once dequeued if its signal was already aborted while waiting', async () => {
    const first = embeddingInferenceHost.embed(['a'], SOURCE, 'org/model', 'q8')
    const worker = fakeWorkers.at(-1)!
    const controller = new AbortController()
    const second = embeddingInferenceHost.embed(['b'], SOURCE, 'org/model', 'q8', controller.signal)

    controller.abort()
    worker.emit('message', { type: 'result', id: lastRequestId(worker), embeddings: [[0.1]] })
    await first

    await expect(second).rejects.toThrow()
    // The aborted request never reached the worker.
    expect(worker.postMessage.mock.calls.filter(([msg]) => (msg as { id?: string }).id !== undefined)).toHaveLength(1)
  })
})

describe('InferenceHost terminateThen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fakeWorkers.length = 0
  })

  afterEach(async () => {
    await embeddingInferenceHost.terminate()
  })

  it('blocks a request queued behind the in-flight one from respawning a worker while `after` runs', async () => {
    const first = embeddingInferenceHost.embed(['a'], SOURCE, 'org/model', 'q8')
    const worker = fakeWorkers.at(-1)!
    // Queued behind `first` (concurrency: 1) — not yet dispatched to any worker.
    const second = embeddingInferenceHost.embed(['b'], SOURCE, 'org/model', 'q8')

    const after = vi.fn(async () => {})
    const done = embeddingInferenceHost.terminateThen(after)

    // terminate() rejects the in-flight first request...
    await expect(first).rejects.toThrow(/terminated/)
    // ...which frees the queue slot for the second — it must reject too, because
    // `after` hasn't run yet, instead of silently respawning a worker to serve it.
    await expect(second).rejects.toThrow(/shutting down/)
    expect(fakeWorkers).toHaveLength(1)

    await done
    expect(after).toHaveBeenCalledTimes(1)

    // Normal service resumes once terminateThen settles.
    const third = embeddingInferenceHost.embed(['c'], SOURCE, 'org/model', 'q8')
    const newWorker = fakeWorkers.at(-1)!
    expect(newWorker).not.toBe(worker)
    newWorker.emit('message', { type: 'result', id: lastRequestId(newWorker), embeddings: [[0.3]] })
    await expect(third).resolves.toEqual([[0.3]])
  })

  it('still runs `after` and resumes even when nothing was in flight to terminate', async () => {
    const after = vi.fn(async () => 'done')

    await expect(embeddingInferenceHost.terminateThen(after)).resolves.toBe('done')
    expect(after).toHaveBeenCalledTimes(1)

    const pending = embeddingInferenceHost.embed(['a'], SOURCE, 'org/model', 'q8')
    const worker = fakeWorkers.at(-1)!
    worker.emit('message', { type: 'result', id: lastRequestId(worker), embeddings: [[0.1]] })
    await expect(pending).resolves.toEqual([[0.1]])
  })

  it('lifecycle shutdown (onStop) also blocks a queued request from respawning a worker', async () => {
    const first = embeddingInferenceHost.embed(['a'], SOURCE, 'org/model', 'q8')
    const worker = fakeWorkers.at(-1)!
    // Queued behind `first` (concurrency: 1) — not yet dispatched to any worker.
    const second = embeddingInferenceHost.embed(['b'], SOURCE, 'org/model', 'q8')

    const stopped = (embeddingInferenceHost as any).onStop()

    // A bare terminate() (the pre-fix shutdown path) only rejects `first` — this
    // asserts `second` also rejects instead of silently respawning a worker.
    await expect(first).rejects.toThrow(/terminated/)
    await expect(second).rejects.toThrow(/shutting down/)
    expect(fakeWorkers).toHaveLength(1)

    await stopped

    // Normal service resumes once shutdown settles.
    const third = embeddingInferenceHost.embed(['c'], SOURCE, 'org/model', 'q8')
    const newWorker = fakeWorkers.at(-1)!
    expect(newWorker).not.toBe(worker)
    newWorker.emit('message', { type: 'result', id: lastRequestId(newWorker), embeddings: [[0.3]] })
    await expect(third).resolves.toEqual([[0.3]])
  })
})

describe('InferenceHost abort listener cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fakeWorkers.length = 0
  })

  afterEach(async () => {
    await embeddingInferenceHost.terminate()
  })

  it('removes the abort listener once a request settles normally, not just on abort', async () => {
    const controller = new AbortController()
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener')

    const pending = embeddingInferenceHost.embed(['hi'], SOURCE, 'org/model', 'q8', controller.signal)
    const worker = fakeWorkers.at(-1)!
    worker.emit('message', { type: 'result', id: lastRequestId(worker), embeddings: [[0.1]] })
    await pending

    // A caller reusing this same long-lived signal for many embed() calls (e.g.
    // across a whole knowledge-base indexing job) must not accumulate one dead
    // listener per call.
    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it('removes the abort listener when the worker crashes mid-request too', async () => {
    const controller = new AbortController()
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener')

    const pending = embeddingInferenceHost.embed(['hi'], SOURCE, 'org/model', 'q8', controller.signal)
    const worker = fakeWorkers.at(-1)!
    worker.emit('exit', 1)

    await expect(pending).rejects.toThrow()
    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function))
  })
})
