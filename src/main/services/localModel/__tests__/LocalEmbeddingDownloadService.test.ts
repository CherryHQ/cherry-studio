import type * as NodeFs from 'node:fs'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  acquireEmbeddingModelRemovalGuard,
  loadEmbedding,
  releaseRemovalGuard,
  terminate,
  terminateThen,
  readdirSync,
  rm
} = vi.hoisted(() => {
  const terminate = vi.fn()
  // terminateThen mirrors the real terminate-then-run-after ordering so the
  // invocationCallOrder assertions below (terminate before rm) still hold.
  const terminateThen = vi.fn(async (after: () => Promise<unknown>) => {
    await terminate()
    return after()
  })
  return {
    acquireEmbeddingModelRemovalGuard: vi.fn(),
    loadEmbedding: vi.fn(),
    releaseRemovalGuard: vi.fn(),
    terminate,
    terminateThen,
    readdirSync: vi.fn(),
    rm: vi.fn()
  }
})

vi.mock('@data/services/KnowledgeBaseService', () => ({
  knowledgeBaseService: { acquireEmbeddingModelRemovalGuard }
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const result = mockApplicationFactory()
  const originalGet = result.application.get.getMockImplementation()!
  result.application.get.mockImplementation((name: string) => {
    if (name === 'EmbeddingInferenceService') return { loadEmbedding, terminate, terminateThen }
    return originalGet(name)
  })
  return result
})

// Controllable fs for the ready probe (readdirSync) and remove (promises.rm).
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof NodeFs>('node:fs')
  const patched = { ...actual, readdirSync, promises: { ...actual.promises, rm } }
  return { ...patched, default: patched }
})

vi.mock('@main/ai/provider/custom/localEmbedding/localEmbeddingRuntime', () => ({
  currentModelSource: () => ({})
}))

// onnxruntime binary presence is a separate concern (see OnnxRuntimeBinaryService.test.ts) —
// stub it as always-ready/no-op here so these tests only exercise the model-weight lifecycle.
vi.mock('@main/services/localModel/OnnxRuntimeBinaryService', () => ({
  onnxRuntimeBinaryService: {
    isReady: vi.fn(() => true),
    ensure: vi.fn(async () => undefined)
  }
}))

// Pin to a supported platform so the ready probe is deterministic regardless of
// the machine this runs on (see LocalModelDownloadService.darwinX64.test.ts for the gate).
vi.mock('@main/core/platform', () => ({ isDarwinX64: false }))

const { application } = await import('@application')
const { localEmbeddingDownloadService } = await import('../LocalEmbeddingDownloadService')

/** The dedicated cache root — cleanup/removal target it whole so no empty
 * `onnx-community/` parent chain survives (the weights nest two levels below). */
const MODELS_ROOT = '/mock/feature.embedding.models'
const READY_FILE = 'model_quantized.onnx'

function broadcastSpy() {
  return vi.mocked(application.get('IpcApiService').broadcast)
}

/** A flat (non-directory) dirent for the recursive `containsFile` probe. */
function fileEntry(name: string): NodeFs.Dirent {
  return { name, isDirectory: () => false } as unknown as NodeFs.Dirent
}

describe('LocalEmbeddingDownloadService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    acquireEmbeddingModelRemovalGuard.mockReturnValue(releaseRemovalGuard)
    rm.mockResolvedValue(undefined)
  })

  describe('ready probe', () => {
    it('reports ready when the quantized weights exist under the cache dir', () => {
      readdirSync.mockReturnValue([fileEntry(READY_FILE)])

      expect(localEmbeddingDownloadService.getStatus()).toBe('ready')
    })

    it('reports not_downloaded when the cache dir is absent', () => {
      readdirSync.mockImplementation(() => {
        throw new Error('ENOENT')
      })

      expect(localEmbeddingDownloadService.getStatus()).toBe('not_downloaded')
    })
  })

  it('drives the progress bar off the .onnx weights only, then reports ready', async () => {
    loadEmbedding.mockImplementation(async (_source, _repo, _dtype, onProgress) => {
      // The tiny sidecar files each sweep 0→100 before the weights start — they must
      // not move the bar; only the .onnx weights (≈99% of the download) drive it.
      onProgress?.({ status: 'progress', file: 'tokenizer.json', progress: 100 })
      onProgress?.({ status: 'progress', file: READY_FILE, progress: 0 })
      onProgress?.({ status: 'progress', file: READY_FILE, progress: 42 })
    })

    await localEmbeddingDownloadService.download()

    // The onnxruntime phase owns the bar's first 10%, so the weights' first bytes
    // hold the bar there instead of resetting it to 0 (the "10% → 0%" flicker).
    expect(broadcastSpy()).toHaveBeenCalledWith(
      'local_model.download_progress',
      expect.objectContaining({ file: READY_FILE, percent: 10 })
    )
    // ...and the weights' own 0–100 maps onto the remaining 10–100 span: 10 + 42 * 0.9.
    expect(broadcastSpy()).toHaveBeenCalledWith(
      'local_model.download_progress',
      expect.objectContaining({ file: READY_FILE, percent: 48 })
    )
    expect(broadcastSpy()).not.toHaveBeenCalledWith(
      'local_model.download_progress',
      expect.objectContaining({ file: 'tokenizer.json' })
    )
    expect(broadcastSpy()).toHaveBeenCalledWith(
      'local_model.download_progress',
      expect.objectContaining({ status: 'ready', percent: 100 })
    )
  })

  it('holds the bar at 100 through the dataless done event instead of snapping to 0', async () => {
    loadEmbedding.mockImplementation(async (_source, _repo, _dtype, onProgress) => {
      // transformers.js brackets the byte stream with dataless 'initiate'/'done' events;
      // only the middle 'progress' events carry loaded/total.
      onProgress?.({ status: 'initiate', file: READY_FILE })
      onProgress?.({ status: 'progress', file: READY_FILE, progress: 100, loaded: 614, total: 614 })
      onProgress?.({ status: 'done', file: READY_FILE })
    })

    await localEmbeddingDownloadService.download()

    // The dataless events must never report 0 — that snapped the full bar back to empty
    // right before the terminal 'ready' (the "100% → 0%" flicker).
    expect(broadcastSpy()).not.toHaveBeenCalledWith(
      'local_model.download_progress',
      expect.objectContaining({ file: READY_FILE, percent: 0 })
    )
    // 'done' means the weights are fully on disk — keep the bar full until terminal ready.
    expect(broadcastSpy()).toHaveBeenCalledWith(
      'local_model.download_progress',
      expect.objectContaining({ status: 'done', percent: 100 })
    )
  })

  describe('remove', () => {
    it('keeps the weights when a knowledge base still references the model', async () => {
      acquireEmbeddingModelRemovalGuard.mockReturnValueOnce(undefined)

      await expect(localEmbeddingDownloadService.remove()).resolves.toEqual({ removed: false })

      // Deleting them would strand that base on a model whose files are gone.
      expect(terminate).not.toHaveBeenCalled()
      expect(rm).not.toHaveBeenCalled()
    })

    it('terminates the worker before deleting the weights when the model is unused', async () => {
      await expect(localEmbeddingDownloadService.remove()).resolves.toEqual({ removed: true })

      expect(terminate).toHaveBeenCalledTimes(1)
      expect(rm).toHaveBeenCalledWith(MODELS_ROOT, { recursive: true, force: true })
      // The worker holds the weights open — release it first or the unlink fails on Windows.
      expect(terminate.mock.invocationCallOrder[0]).toBeLessThan(rm.mock.invocationCallOrder[0])
      expect(vi.mocked(application.get('DbService').getDb().delete)).not.toHaveBeenCalled()
      expect(releaseRemovalGuard).toHaveBeenCalledOnce()
    })

    it('holds the removal guard until the asynchronous weight deletion completes', async () => {
      let finishRemoval: (() => void) | undefined
      rm.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishRemoval = resolve
          })
      )

      const pendingRemoval = localEmbeddingDownloadService.remove()
      await vi.waitFor(() => expect(rm).toHaveBeenCalledOnce())
      expect(releaseRemovalGuard).not.toHaveBeenCalled()

      finishRemoval?.()
      await expect(pendingRemoval).resolves.toEqual({ removed: true })
      expect(releaseRemovalGuard).toHaveBeenCalledOnce()
    })

    it('releases the removal guard when weight deletion fails', async () => {
      rm.mockRejectedValueOnce(new Error('disk busy'))

      await expect(localEmbeddingDownloadService.remove()).rejects.toThrow('disk busy')

      expect(releaseRemovalGuard).toHaveBeenCalledOnce()
    })
  })

  it('cancel aborts the in-flight download and terminates the worker', async () => {
    loadEmbedding.mockImplementation(
      (_source, _repo, _dtype, _onProgress, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          // Mirror InferenceServiceBase.send's fail-fast check: an await between download() and
          // this call (e.g. resolving the model source) can let cancel() abort the signal
          // before this listener attaches, so an already-aborted signal must reject directly.
          if (signal.aborted) return reject(signal.reason ?? new Error('aborted'))
          signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')), { once: true })
        })
    )

    const pending = localEmbeddingDownloadService.download()
    localEmbeddingDownloadService.cancel()

    await expect(pending).resolves.toBe('cancelled')
    expect(terminate).toHaveBeenCalled()
    // A user cancel is not a failure — no error broadcast.
    expect(broadcastSpy()).not.toHaveBeenCalledWith(
      'local_model.download_progress',
      expect.objectContaining({ status: 'error' })
    )
    expect(broadcastSpy()).toHaveBeenCalledWith(
      'local_model.download_progress',
      expect.objectContaining({ status: 'not_downloaded', percent: 0 })
    )
  })
})
