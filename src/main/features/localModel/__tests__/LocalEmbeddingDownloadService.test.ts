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
    if (name === 'EmbeddingInferenceHost') return { loadEmbedding, terminate, terminateThen }
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

vi.mock('@main/features/localModel/localEmbeddingRegistration', () => ({
  registerLocalEmbeddingModel,
  unregisterLocalEmbeddingModelIfUnused: unregisterMock
}))

// Pin to a supported platform so the ready probe is deterministic regardless of
// the machine this runs on (see LocalModelDownloadService.darwinX64.test.ts for the gate).
vi.mock('@main/core/platform', () => ({ isDarwinX64: false }))

const { application } = await import('@application')
const { localEmbeddingDownloadService } = await import('../LocalEmbeddingDownloadService')

/** Where the q8 weights land: `<models>/<repo owner>/<repo name>` (see LOCAL_MODELS.embedding). */
const MODEL_DIR = '/mock/feature.embedding.models/onnx-community/Qwen3-Embedding-0.6B-ONNX'
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

  it('drives the progress bar off the .onnx weights only, then registers and reports ready', async () => {
    loadEmbedding.mockImplementation(async (_source, _repo, _dtype, onProgress) => {
      // The tiny sidecar files each sweep 0→100 before the weights start — they must
      // not move the bar; only the .onnx weights (≈99% of the download) drive it.
      onProgress?.({ status: 'progress', file: 'tokenizer.json', progress: 100 })
      onProgress?.({ status: 'progress', file: READY_FILE, progress: 42 })
    })

    await localEmbeddingDownloadService.download()

    expect(broadcastSpy()).toHaveBeenCalledWith(
      'local_model.download_progress',
      expect.objectContaining({ file: READY_FILE, percent: 42 })
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
      expect(rm).toHaveBeenCalledWith(MODEL_DIR, { recursive: true, force: true })
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
    expect(rm).toHaveBeenCalledWith(MODEL_DIR, { recursive: true, force: true })
  })
})
