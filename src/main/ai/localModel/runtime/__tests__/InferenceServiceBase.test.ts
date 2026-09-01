import { EventEmitter } from 'node:events'

import type { ProxyRoutingSnapshot } from '@main/services/proxy/proxyRouting'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A stand-in for the real `worker_threads` Worker: captures the lifecycle event
 * handlers InferenceServiceBase registers (`message`/`error`/`exit`) and lets the test
 * drive them, so we can exercise the exit/failAll logic without a real worker.
 */
class FakeWorker extends EventEmitter {
  postMessage = vi.fn()
  unref = vi.fn()
  terminate = vi.fn(async () => 0)
}

const fakeWorkers: FakeWorker[] = []
const getRoutingSnapshot = vi.hoisted(() => vi.fn())
const resolveLocalInferenceProfile = vi.hoisted(() =>
  vi.fn((enabled: boolean) =>
    enabled
      ? {
          id: 'directml',
          transformersDevice: 'dml',
          sessionOptions: {
            executionProviders: ['dml', 'cpu'],
            enableMemPattern: false,
            executionMode: 'sequential'
          }
        }
      : { id: 'cpu', transformersDevice: 'cpu', sessionOptions: { executionProviders: ['cpu'] } }
  )
)

const DIRECT_ROUTING: ProxyRoutingSnapshot = { version: 1, mode: 'direct' }

vi.mock('node:worker_threads', () => ({
  Worker: vi.fn(() => {
    const worker = new FakeWorker()
    fakeWorkers.push(worker)
    return worker
  })
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const result = mockApplicationFactory()
  const originalGet = result.application.get.getMockImplementation()!
  result.application.get.mockImplementation((name: string) => {
    if (name === 'ProxyService') return { getRoutingSnapshot }
    return originalGet(name)
  })
  return result
})

vi.mock('../../installation/LocalModelStorageService', () => ({
  localModelStorageService: {
    resolveInstalledDir: () => '/models/qwen3-embedding/org/model',
    isArtifactReady: () => true,
    isArtifactSupported: () => true,
    artifactPath: () => '/runtime/onnxruntime_binding.node'
  }
}))

vi.mock('../inferenceAcceleration', () => ({
  CPU_LOCAL_INFERENCE_PROFILE: {
    id: 'cpu',
    transformersDevice: 'cpu',
    sessionOptions: { executionProviders: ['cpu'] }
  },
  resolveLocalInferenceProfile
}))

// Import the SUT after the worker mock is declared (it constructs a Worker lazily on first send).
const { EmbeddingInferenceService } = await import('../../capabilities/embedding/EmbeddingInferenceService')
const { OcrInferenceService } = await import('../../capabilities/ocr/OcrInferenceService')
const embeddingInferenceService = new EmbeddingInferenceService()
const ocrInferenceService = new OcrInferenceService()

/** Where the main process probed the complete cache — inference loads the model from here. */
const MODEL_DIR = '/models/qwen3-embedding/org/model'

getRoutingSnapshot.mockResolvedValue(DIRECT_ROUTING)

beforeEach(() => {
  MockMainPreferenceServiceUtils.resetMocks()
  getRoutingSnapshot.mockResolvedValue(DIRECT_ROUTING)
})

async function latestWorker(minimumCount = 1): Promise<FakeWorker> {
  for (let attempt = 0; attempt < 20 && fakeWorkers.length < minimumCount; attempt += 1) {
    await Promise.resolve()
  }
  if (fakeWorkers.length < minimumCount) throw new Error(`expected ${minimumCount} inference worker(s)`)
  return fakeWorkers.at(-1)!
}

async function waitForPostedRequests(worker: FakeWorker, count: number): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const posted = worker.postMessage.mock.calls.filter(
      ([message]) => (message as { requestId?: string }).requestId !== undefined
    )
    if (posted.length >= count) return
    await Promise.resolve()
  }
  throw new Error(`expected ${count} inference request(s)`)
}

/** The id InferenceServiceBase stamped onto the embed request (the init message carries none). */
function lastRequestId(worker: FakeWorker): string {
  const call = worker.postMessage.mock.calls.find(
    ([message]) => (message as { requestId?: string }).requestId !== undefined
  )
  return (call![0] as { requestId: string }).requestId
}

/** The id stamped onto the most recently posted request (for a worker that already
 * skipped its one-time init message, i.e. a second+ request on the same worker). */
function lastPostedId(worker: FakeWorker): string {
  const [message] = worker.postMessage.mock.calls.at(-1)!
  return (message as { requestId: string }).requestId
}

describe('InferenceService worker exit / failAll', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fakeWorkers.length = 0
  })

  // Each test ends with the worker nulled (via exit or terminate), so the singleton is clean.
  afterEach(async () => {
    await embeddingInferenceService.terminate()
  })

  it('rejects in-flight requests when the worker exits cleanly (code 0) instead of hanging forever', async () => {
    const pending = embeddingInferenceService.embed(['hi'])
    const worker = await latestWorker()

    worker.emit('exit', 0)

    await expect(pending).rejects.toThrow(/exited unexpectedly \(code 0\)/)
    // failAll logs once for the in-flight rejection; a clean exit is not "abnormal".
    expect(mockMainLoggerService.error).toHaveBeenCalledTimes(1)
  })

  it('logs an abnormal (non-zero) exit even when no request is in flight (idle crash visibility)', async () => {
    const pending = embeddingInferenceService.embed(['hi'])
    const worker = await latestWorker()

    // Settle the request so the worker goes idle (pending empty) before it crashes.
    worker.emit('message', { kind: 'result', requestId: lastRequestId(worker), payload: { embeddings: [[0.1, 0.2]] } })
    await pending

    worker.emit('exit', 1)

    // The non-zero exit must still be logged, otherwise the auto-respawn is silent.
    expect(mockMainLoggerService.error).toHaveBeenCalledWith('inference worker exited abnormally', expect.any(Error))
  })

  it('replaces a failed worker before dispatching the next queued request', async () => {
    const first = embeddingInferenceService.embed(['a'])
    const failedWorker = await latestWorker()
    const second = embeddingInferenceService.embed(['b'])

    failedWorker.emit('error', new Error('worker crashed'))

    await expect(first).rejects.toThrow('worker crashed')
    const replacement = await latestWorker(2)
    replacement.emit('message', {
      kind: 'result',
      requestId: lastRequestId(replacement),
      payload: { embeddings: [[0.2]] }
    })
    await expect(second).resolves.toEqual([[0.2]])
  })

  it('does not double-report when terminate() is followed by the worker exit event', async () => {
    const pending = embeddingInferenceService.embed(['hi'])
    const worker = await latestWorker()

    await embeddingInferenceService.terminate()
    await expect(pending).rejects.toThrow(/terminated/)
    const afterTerminate = mockMainLoggerService.error.mock.calls.length

    // The terminated worker eventually emits exit; failAll no-ops (pending already cleared).
    worker.emit('exit', 0)

    expect(mockMainLoggerService.error.mock.calls.length).toBe(afterTerminate)
  })

  it('does not spawn a worker after terminate wins a pending proxy-snapshot race', async () => {
    let resolveRouting!: (routing: ProxyRoutingSnapshot) => void
    getRoutingSnapshot.mockReturnValueOnce(
      new Promise<ProxyRoutingSnapshot>((resolve) => {
        resolveRouting = resolve
      })
    )
    const pending = embeddingInferenceService.embed(['hi'])
    for (let attempt = 0; attempt < 10 && getRoutingSnapshot.mock.calls.length === 0; attempt += 1) {
      await Promise.resolve()
    }

    await embeddingInferenceService.terminate()
    resolveRouting(DIRECT_ROUTING)

    await expect(pending).rejects.toThrow(/terminated/)
    expect(fakeWorkers).toHaveLength(0)
  })

  it('terminate() resolves only once the worker has actually exited, not just been asked to', async () => {
    // terminate() rejects this in-flight request synchronously — swallow it here, but still
    // await it below so the shared queue's concurrency slot is fully released before the
    // test ends (concurrency: 1 means a lingering unsettled request blocks the next test).
    const rejected = embeddingInferenceService.embed(['hi']).catch(() => {})
    const worker = await latestWorker()
    let releaseExit: (code: number) => void = () => {}
    worker.terminate.mockImplementation(() => new Promise<number>((resolve) => (releaseExit = resolve)))

    let settled = false
    const done = embeddingInferenceService.terminate().then(() => {
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
    const stale = embeddingInferenceService.embed(['a'])
    const workerA = await latestWorker()

    // Tear down A (rejecting its own in-flight), then start a fresh request → worker B.
    await embeddingInferenceService.terminate()
    await expect(stale).rejects.toThrow(/terminated/)
    const live = embeddingInferenceService.embed(['b'])
    const workerB = await latestWorker(2)
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
    workerB.emit('message', { kind: 'result', requestId: lastRequestId(workerB), payload: { embeddings: [[0.1]] } })
    await live

    const reused = embeddingInferenceService.embed(['c'])
    expect(fakeWorkers).toHaveLength(2)
    await waitForPostedRequests(workerB, 2)
    workerB.emit('message', { kind: 'result', requestId: lastPostedId(workerB), payload: { embeddings: [[0.2]] } })
    await reused
  })

  it("ignores a superseded worker's late error instead of rejecting the live worker's requests", async () => {
    const stale = embeddingInferenceService.embed(['a'])
    const workerA = await latestWorker()

    await embeddingInferenceService.terminate()
    await expect(stale).rejects.toThrow(/terminated/)
    const live = embeddingInferenceService.embed(['b'])
    const workerB = await latestWorker(2)
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
    workerB.emit('message', { kind: 'result', requestId: lastRequestId(workerB), payload: { embeddings: [[0.1]] } })
    await live
  })
})

describe('embeddingInferenceService / ocrInferenceService isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fakeWorkers.length = 0
  })

  afterEach(async () => {
    await embeddingInferenceService.terminate()
    await ocrInferenceService.terminate()
  })

  it('terminating the embedding host does not touch an in-flight OCR request or its worker', async () => {
    const ocrPending = ocrInferenceService.recognize({ kind: 'path', imagePath: '/img.png' })
    const ocrWorker = await latestWorker()

    const embedRejected = embeddingInferenceService.embed(['hi']).catch(() => {})
    const embeddingWorker = await latestWorker(2)
    expect(embeddingWorker).not.toBe(ocrWorker)

    await embeddingInferenceService.terminate()
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

    ocrWorker.emit('message', {
      kind: 'result',
      requestId: lastRequestId(ocrWorker),
      payload: { text: 'ok', lines: [] }
    })
    await expect(ocrPending).resolves.toEqual({ text: 'ok', lines: [] })
  })
})

describe('InferenceService worker init message', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fakeWorkers.length = 0
  })

  afterEach(async () => {
    await embeddingInferenceService.terminate()
    await ocrInferenceService.terminate()
  })

  /** The one-time init message is the first thing posted to a freshly spawned worker. */
  function initMessage(worker: FakeWorker): {
    kind: string
    capability?: string
    appPath?: string
    proxyRouting?: ProxyRoutingSnapshot
    runtimeProfile?: { id: string }
  } {
    return worker.postMessage.mock.calls[0][0] as {
      kind: string
      capability?: string
      appPath?: string
      proxyRouting?: ProxyRoutingSnapshot
      runtimeProfile?: { id: string }
    }
  }

  it('inits each capability worker with the app root, proxy routing and acceleration profile', async () => {
    const embedPending = embeddingInferenceService.embed(['hi'])
    const embeddingWorker = await latestWorker()
    const embedInit = initMessage(embeddingWorker)
    expect(embedInit.kind).toBe('init')
    expect(embedInit.capability).toBe('embedding')
    expect(embedInit.appPath).toBeTruthy()
    expect(embedInit.proxyRouting).toEqual(DIRECT_ROUTING)
    expect(embedInit.runtimeProfile?.id).toBe('directml')
    // Settle so the shared queue's concurrency slot is free for the OCR request below.
    embeddingWorker.emit('message', {
      kind: 'result',
      requestId: lastRequestId(embeddingWorker),
      payload: { embeddings: [[0.1]] }
    })
    await embedPending

    const ocrPending = ocrInferenceService.recognize({ kind: 'path', imagePath: '/img.png' })
    const ocrWorker = await latestWorker(2)
    const ocrInit = initMessage(ocrWorker)
    expect(ocrInit.kind).toBe('init')
    expect(ocrInit.capability).toBe('ocr')
    expect(ocrInit.appPath).toBeTruthy()
    expect(ocrInit.proxyRouting).toEqual(DIRECT_ROUTING)
    expect(ocrInit.runtimeProfile?.id).toBe('directml')
    ocrWorker.emit('message', {
      kind: 'result',
      requestId: lastRequestId(ocrWorker),
      payload: { text: 'ok', lines: [] }
    })
    await ocrPending
  })

  it('finishes the active request before applying an updated acceleration profile to the next worker', async () => {
    const first = embeddingInferenceService.embed(['first'])
    const workerA = await latestWorker()
    const second = embeddingInferenceService.embed(['second'])

    MockMainPreferenceServiceUtils.setPreferenceValue('feature.local_model.hardware_acceleration.enabled', false)
    expect(workerA.terminate).not.toHaveBeenCalled()

    workerA.emit('message', { kind: 'result', requestId: lastRequestId(workerA), payload: { embeddings: [[0.1]] } })
    await first

    const workerB = await latestWorker(2)
    expect(workerA.terminate).toHaveBeenCalledTimes(1)
    expect(initMessage(workerB).runtimeProfile?.id).toBe('cpu')

    workerB.emit('message', { kind: 'result', requestId: lastRequestId(workerB), payload: { embeddings: [[0.2]] } })
    await expect(second).resolves.toEqual([[0.2]])
  })

  it('restarts the worker before the next request when ProxyService advances the routing version', async () => {
    const first = embeddingInferenceService.embed(['first'])
    const workerA = await latestWorker()
    workerA.emit('message', { kind: 'result', requestId: lastRequestId(workerA), payload: { embeddings: [[0.1]] } })
    await first

    const updatedRouting: ProxyRoutingSnapshot = { version: 2, mode: 'direct' }
    getRoutingSnapshot.mockResolvedValue(updatedRouting)
    const second = embeddingInferenceService.embed(['second'])
    const workerB = await latestWorker(2)

    expect(workerA.terminate).toHaveBeenCalledTimes(1)
    expect(workerB).not.toBe(workerA)
    expect(initMessage(workerB).proxyRouting).toEqual(updatedRouting)
    workerB.emit('message', { kind: 'result', requestId: lastRequestId(workerB), payload: { embeddings: [[0.2]] } })
    await expect(second).resolves.toEqual([[0.2]])
  })

  it('does not respawn after terminate wins a routing-version teardown race', async () => {
    const first = embeddingInferenceService.embed(['first'])
    const workerA = await latestWorker()
    workerA.emit('message', { kind: 'result', requestId: lastRequestId(workerA), payload: { embeddings: [[0.1]] } })
    await first

    let releaseExit!: (code: number) => void
    workerA.terminate.mockImplementation(() => new Promise<number>((resolve) => (releaseExit = resolve)))
    getRoutingSnapshot.mockResolvedValue({ version: 2, mode: 'direct' })
    const second = embeddingInferenceService.embed(['second'])
    const rejected = expect(second).rejects.toThrow(/terminated/)
    for (let attempt = 0; attempt < 20 && workerA.terminate.mock.calls.length === 0; attempt += 1) {
      await Promise.resolve()
    }
    expect(workerA.terminate).toHaveBeenCalledTimes(1)

    await embeddingInferenceService.terminate()
    releaseExit(0)

    await rejected
    expect(fakeWorkers).toHaveLength(1)
  })
})

describe('InferenceService idle-release timer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fakeWorkers.length = 0
  })

  afterEach(async () => {
    await embeddingInferenceService.terminate()
    vi.useRealTimers()
  })

  it('releases the worker after an idle timeout', async () => {
    vi.useFakeTimers()

    const pending = embeddingInferenceService.embed(['hi'])
    const worker = await latestWorker()
    worker.emit('message', { kind: 'result', requestId: lastRequestId(worker), payload: { embeddings: [[0.1]] } })
    await pending

    expect(worker.terminate).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(60_000)

    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })

  it('keeps the worker alive when another request arrives before the idle timeout', async () => {
    vi.useFakeTimers()

    const first = embeddingInferenceService.embed(['hi'])
    const worker = await latestWorker()
    worker.emit('message', { kind: 'result', requestId: lastRequestId(worker), payload: { embeddings: [[0.1]] } })
    await first

    await vi.advanceTimersByTimeAsync(30_000)

    const second = embeddingInferenceService.embed(['bye'])
    await waitForPostedRequests(worker, 2)
    worker.emit('message', { kind: 'result', requestId: lastPostedId(worker), payload: { embeddings: [[0.2]] } })
    await second

    await vi.advanceTimersByTimeAsync(59_000)

    // The second request rearmed the timer — still within its own 60s window.
    expect(fakeWorkers).toHaveLength(1)
    expect(worker.terminate).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1_000)

    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })
})

describe('InferenceService request queue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fakeWorkers.length = 0
  })

  afterEach(async () => {
    await embeddingInferenceService.terminate()
  })

  it('serializes concurrent requests so only one is in flight to the worker at a time', async () => {
    const first = embeddingInferenceService.embed(['a'])
    const worker = await latestWorker()
    const second = embeddingInferenceService.embed(['b'])

    const postedRequestCount = () =>
      worker.postMessage.mock.calls.filter(([message]) => (message as { requestId?: string }).requestId !== undefined)
        .length

    // The second request is queued — nothing has been posted for it yet.
    await Promise.resolve()
    await Promise.resolve()
    expect(postedRequestCount()).toBe(1)

    worker.emit('message', { kind: 'result', requestId: lastRequestId(worker), payload: { embeddings: [[0.1]] } })
    await first

    // Settling the first dispatches the second — still to the same (single) worker.
    expect(postedRequestCount()).toBe(2)
    expect(fakeWorkers).toHaveLength(1)

    worker.emit('message', { kind: 'result', requestId: lastPostedId(worker), payload: { embeddings: [[0.2]] } })
    await expect(second).resolves.toEqual([[0.2]])
  })

  it('rejects a queued request immediately once dequeued if its signal was already aborted while waiting', async () => {
    const first = embeddingInferenceService.embed(['a'])
    const worker = await latestWorker()
    const controller = new AbortController()
    const second = embeddingInferenceService.embed(['b'], controller.signal)

    controller.abort()
    worker.emit('message', { kind: 'result', requestId: lastRequestId(worker), payload: { embeddings: [[0.1]] } })
    await first

    await expect(second).rejects.toThrow()
    // The aborted request never reached the worker.
    expect(
      worker.postMessage.mock.calls.filter(([message]) => (message as { requestId?: string }).requestId !== undefined)
    ).toHaveLength(1)
  })
})

describe('InferenceService terminateThen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fakeWorkers.length = 0
  })

  afterEach(async () => {
    await embeddingInferenceService.terminate()
  })

  it('blocks a request queued behind the in-flight one from respawning a worker while `after` runs', async () => {
    const first = embeddingInferenceService.embed(['a'])
    const worker = await latestWorker()
    // Queued behind `first` (concurrency: 1) — not yet dispatched to any worker.
    const second = embeddingInferenceService.embed(['b'])

    const after = vi.fn(async () => {})
    const done = embeddingInferenceService.terminateThen(after)

    // terminate() rejects the in-flight first request...
    await expect(first).rejects.toThrow(/terminated/)
    // ...which frees the queue slot for the second — it must reject too, because
    // `after` hasn't run yet, instead of silently respawning a worker to serve it.
    await expect(second).rejects.toThrow(/shutting down/)
    expect(fakeWorkers).toHaveLength(1)

    await done
    expect(after).toHaveBeenCalledTimes(1)

    // Normal service resumes once terminateThen settles.
    const third = embeddingInferenceService.embed(['c'])
    const newWorker = await latestWorker(2)
    expect(newWorker).not.toBe(worker)
    newWorker.emit('message', { kind: 'result', requestId: lastRequestId(newWorker), payload: { embeddings: [[0.3]] } })
    await expect(third).resolves.toEqual([[0.3]])
  })

  it('still runs `after` and resumes even when nothing was in flight to terminate', async () => {
    const after = vi.fn(async () => 'done')

    await expect(embeddingInferenceService.terminateThen(after)).resolves.toBe('done')
    expect(after).toHaveBeenCalledTimes(1)

    const pending = embeddingInferenceService.embed(['a'])
    const worker = await latestWorker()
    worker.emit('message', { kind: 'result', requestId: lastRequestId(worker), payload: { embeddings: [[0.1]] } })
    await expect(pending).resolves.toEqual([[0.1]])
  })

  it('lifecycle shutdown (onStop) also blocks a queued request from respawning a worker', async () => {
    const first = embeddingInferenceService.embed(['a'])
    const worker = await latestWorker()
    // Queued behind `first` (concurrency: 1) — not yet dispatched to any worker.
    const second = embeddingInferenceService.embed(['b'])

    const stopped = (embeddingInferenceService as any).onStop()

    // A bare terminate() (the pre-fix shutdown path) only rejects `first` — this
    // asserts `second` also rejects instead of silently respawning a worker.
    await expect(first).rejects.toThrow(/terminated/)
    await expect(second).rejects.toThrow(/shutting down/)
    expect(fakeWorkers).toHaveLength(1)

    await stopped

    // Normal service resumes once shutdown settles.
    const third = embeddingInferenceService.embed(['c'])
    const newWorker = await latestWorker(2)
    expect(newWorker).not.toBe(worker)
    newWorker.emit('message', { kind: 'result', requestId: lastRequestId(newWorker), payload: { embeddings: [[0.3]] } })
    await expect(third).resolves.toEqual([[0.3]])
  })
})

describe('EmbeddingInferenceService.embed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fakeWorkers.length = 0
  })

  afterEach(async () => {
    await embeddingInferenceService.terminate()
  })

  it('sends the local source candidates and resolves with the worker-reported embeddings', async () => {
    const pending = embeddingInferenceService.embed(['hi'])
    const worker = await latestWorker()

    const request = worker.postMessage.mock.calls.find(
      ([message]) => (message as { requestId?: string }).requestId !== undefined
    )![0] as {
      type: string
      payload: { modelDir: string; texts: string[] }
    }
    expect(request.type).toBe('embed')
    expect(request.payload.modelDir).toBe(MODEL_DIR)
    expect(request.payload.texts).toEqual(['hi'])

    worker.emit('message', { kind: 'result', requestId: lastRequestId(worker), payload: { embeddings: [[0.1, 0.2]] } })

    await expect(pending).resolves.toEqual([[0.1, 0.2]])
  })

  it('rejects a result that carries no embeddings instead of resolving empty', async () => {
    const pending = embeddingInferenceService.embed(['hi'])
    const worker = await latestWorker()

    // A protocol drift (field renamed / dropped) must fail the request loudly —
    // resolving [] would let empty vectors flow into the index as real ones.
    worker.emit('message', { kind: 'result', requestId: lastRequestId(worker), payload: {} })

    await expect(pending).rejects.toThrow('without embeddings')
  })
})

describe('EmbeddingInferenceService.countTokens', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fakeWorkers.length = 0
  })

  afterEach(async () => {
    await embeddingInferenceService.terminate()
  })

  it('sends an embedding.countTokens request and resolves with the worker-reported counts', async () => {
    const pending = embeddingInferenceService.countTokens(['hi', 'there'])
    const worker = await latestWorker()

    const request = worker.postMessage.mock.calls.find(
      ([message]) => (message as { requestId?: string }).requestId !== undefined
    )![0] as {
      type: string
      payload: { modelDir: string; texts: string[] }
    }
    expect(request.type).toBe('countTokens')
    expect(request.payload.modelDir).toBe(MODEL_DIR)
    expect(request.payload.texts).toEqual(['hi', 'there'])

    worker.emit('message', { kind: 'result', requestId: lastRequestId(worker), payload: { tokenCounts: [1, 2] } })

    await expect(pending).resolves.toEqual([1, 2])
  })

  it('rejects a result that carries no token counts instead of resolving empty', async () => {
    const pending = embeddingInferenceService.countTokens(['hi'])
    const worker = await latestWorker()

    worker.emit('message', { kind: 'result', requestId: lastRequestId(worker), payload: {} })

    await expect(pending).rejects.toThrow('without tokenCounts')
  })

  it('supports aborting a queued countTokens request', async () => {
    const first = embeddingInferenceService.embed(['a'])
    const worker = await latestWorker()
    const controller = new AbortController()
    const second = embeddingInferenceService.countTokens(['b'], controller.signal)

    controller.abort()
    worker.emit('message', { kind: 'result', requestId: lastRequestId(worker), payload: { embeddings: [[0.1]] } })
    await first

    await expect(second).rejects.toThrow()
  })
})

describe('InferenceService abort listener cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fakeWorkers.length = 0
  })

  afterEach(async () => {
    await embeddingInferenceService.terminate()
  })

  it('removes the abort listener once a request settles normally, not just on abort', async () => {
    const controller = new AbortController()
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener')

    const pending = embeddingInferenceService.embed(['hi'], controller.signal)
    const worker = await latestWorker()
    worker.emit('message', { kind: 'result', requestId: lastRequestId(worker), payload: { embeddings: [[0.1]] } })
    await pending

    // A caller reusing this same long-lived signal for many embed() calls (e.g.
    // across a whole knowledge-base indexing job) must not accumulate one dead
    // listener per call.
    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it('removes the abort listener when the worker crashes mid-request too', async () => {
    const controller = new AbortController()
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener')

    const pending = embeddingInferenceService.embed(['hi'], controller.signal)
    const worker = await latestWorker()
    worker.emit('exit', 1)

    await expect(pending).rejects.toThrow()
    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function))
  })
})
