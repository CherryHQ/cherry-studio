import type * as NodeFs from 'node:fs'

import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { loadEmbedding, terminate, terminateThen, registerLocalEmbeddingModel, unregisterMock, readdirSync, rm } =
  vi.hoisted(() => {
    const terminate = vi.fn()
    // terminateThen mirrors the real terminate-then-run-after ordering so the
    // invocationCallOrder assertions below (terminate before rm) still hold.
    const terminateThen = vi.fn(async (after: () => Promise<unknown>) => {
      await terminate()
      return after()
    })
    return {
      loadEmbedding: vi.fn(),
      terminate,
      terminateThen,
      registerLocalEmbeddingModel: vi.fn(),
      unregisterMock: vi.fn(),
      readdirSync: vi.fn(),
      rm: vi.fn()
    }
  })

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

vi.mock('@main/services/localModel/localEmbeddingRegistration', () => ({
  registerLocalEmbeddingModel,
  unregisterLocalEmbeddingModelIfUnused: unregisterMock
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
    registerLocalEmbeddingModel.mockResolvedValue(undefined)
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

  describe('checkStatus (registration self-heal)', () => {
    it('re-registers the provider/model rows before reporting ready', async () => {
      readdirSync.mockReturnValue([fileEntry(READY_FILE)])

      // The DB can be reset underneath the weights (factory reset keeps the
      // model artifacts; a restored backup may predate the download) — a
      // consumer acting on `ready` must always find the user_model row.
      await expect(localEmbeddingDownloadService.checkStatus()).resolves.toBe('ready')
      expect(registerLocalEmbeddingModel).toHaveBeenCalledOnce()
    })

    it('does not touch the DB when the weights are absent', async () => {
      readdirSync.mockImplementation(() => {
        throw new Error('ENOENT')
      })

      await expect(localEmbeddingDownloadService.checkStatus()).resolves.toBe('not_downloaded')
      expect(registerLocalEmbeddingModel).not.toHaveBeenCalled()
    })

    it('rejects instead of reporting an unusable ready when the repair fails', async () => {
      readdirSync.mockReturnValue([fileEntry(READY_FILE)])
      registerLocalEmbeddingModel.mockRejectedValue(new Error('db locked'))

      // Callers treat the probe as best-effort (KB creation falls back to
      // BM25-only) — an unregistered `ready` would trip the embeddingModelId FK.
      await expect(localEmbeddingDownloadService.checkStatus()).rejects.toThrow('db locked')
    })
  })

  it('drives the progress bar off the .onnx weights only, then registers and reports ready', async () => {
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
    // Only registered once the weights are on disk (lazy equivalent of the boot seeder).
    expect(registerLocalEmbeddingModel).toHaveBeenCalledTimes(1)
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
    // right before the post-registration 'ready' (the "100% → 0%" flicker).
    expect(broadcastSpy()).not.toHaveBeenCalledWith(
      'local_model.download_progress',
      expect.objectContaining({ file: READY_FILE, percent: 0 })
    )
    // 'done' means the weights are fully on disk — keep the bar full through registration.
    expect(broadcastSpy()).toHaveBeenCalledWith(
      'local_model.download_progress',
      expect.objectContaining({ status: 'done', percent: 100 })
    )
  })

  describe('remove', () => {
    it('keeps the weights when a knowledge base still references the model', async () => {
      unregisterMock.mockResolvedValue({ removed: false })

      await expect(localEmbeddingDownloadService.remove()).resolves.toEqual({ removed: false })

      // Deleting them would strand that base on a model whose files are gone.
      expect(terminate).not.toHaveBeenCalled()
      expect(rm).not.toHaveBeenCalled()
    })

    it('terminates the worker before deleting the weights when the model is unused', async () => {
      unregisterMock.mockResolvedValue({ removed: true })

      await expect(localEmbeddingDownloadService.remove()).resolves.toEqual({ removed: true })

      expect(terminate).toHaveBeenCalledTimes(1)
      expect(rm).toHaveBeenCalledWith(MODELS_ROOT, { recursive: true, force: true })
      // The worker holds the weights open — release it first or the unlink fails on Windows.
      expect(terminate.mock.invocationCallOrder[0]).toBeLessThan(rm.mock.invocationCallOrder[0])
    })

    it('re-registers the model when deleting the weights fails, so files and DB stay consistent', async () => {
      unregisterMock.mockResolvedValue({ removed: true })
      rm.mockRejectedValue(new Error('EBUSY')) // e.g. a Windows lock survives the unlink

      await expect(localEmbeddingDownloadService.remove()).rejects.toThrow('EBUSY')

      // Row already deleted but weights survived → re-register so the leftover weights
      // don't read as a `ready` model with no user_model row.
      expect(registerLocalEmbeddingModel).toHaveBeenCalledTimes(1)
    })

    it('logs the original deletion error even when the compensating re-register also fails', async () => {
      unregisterMock.mockResolvedValue({ removed: true })
      rm.mockRejectedValue(new Error('EBUSY'))
      registerLocalEmbeddingModel.mockRejectedValue(new Error('db down')) // compensation fails too

      await expect(localEmbeddingDownloadService.remove()).rejects.toThrow()

      // The deletion breadcrumb is logged before the re-register runs, so it survives the
      // re-register throwing over the rethrow.
      expect(mockMainLoggerService.warn).toHaveBeenCalledWith(
        expect.stringContaining('re-registering'),
        expect.any(Error)
      )
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

    await expect(pending).rejects.toThrow()
    expect(terminate).toHaveBeenCalled()
    // A user cancel is not a failure — no error broadcast.
    expect(broadcastSpy()).not.toHaveBeenCalledWith(
      'local_model.download_progress',
      expect.objectContaining({ status: 'error' })
    )
  })

  it('cleans up the weights when registration fails, leaving no orphan ready state', async () => {
    loadEmbedding.mockResolvedValue(undefined) // weights land on disk...
    registerLocalEmbeddingModel.mockRejectedValue(new Error('db down')) // ...but the row write fails

    await expect(localEmbeddingDownloadService.download()).rejects.toThrow('db down')

    // Weights present + no user_model row would read as `ready` and trip the KB FK on select.
    expect(terminate).toHaveBeenCalled()
    expect(rm).toHaveBeenCalledWith(MODELS_ROOT, { recursive: true, force: true })
  })
})
