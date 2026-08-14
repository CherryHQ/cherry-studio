import type * as NodeFs from 'node:fs'

import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  acquireEmbeddingModelRemovalGuard,
  isInChina,
  loadEmbedding,
  ensureOnnxRuntime,
  onnxRuntimeIsReady,
  releaseRemovalGuard,
  terminate,
  terminateThen,
  existsSync,
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
    isInChina: vi.fn(),
    loadEmbedding: vi.fn(),
    ensureOnnxRuntime: vi.fn(),
    onnxRuntimeIsReady: vi.fn(),
    releaseRemovalGuard: vi.fn(),
    terminate,
    terminateThen,
    existsSync: vi.fn(),
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

// Controllable fs for the cache probe (existsSync) and remove (promises.rm).
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof NodeFs>('node:fs')
  const patched = { ...actual, existsSync, promises: { ...actual.promises, rm } }
  return { ...patched, default: patched }
})

// The egress-region signal only decides which mirror is tried first — pin it so the
// mirror-order assertions below don't depend on where the test machine runs.
vi.mock('@main/services/RegionService', () => ({ regionService: { isInChina } }))

// onnxruntime binary presence is a separate concern (see OnnxRuntimeBinaryService.test.ts).
// Keep it ready/no-op by default, while allowing the runtime-repair regression to model
// the missing-binary state that triggers the cache-aware mirror path.
vi.mock('@main/services/localModel/OnnxRuntimeBinaryService', () => ({
  onnxRuntimeBinaryService: {
    isReady: onnxRuntimeIsReady,
    ensure: ensureOnnxRuntime
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
const MODEL_DIR = `${MODELS_ROOT}/onnx-community/Qwen3-Embedding-0.6B-ONNX`
const READY_FILE = 'model_quantized.onnx'

function broadcastSpy() {
  return vi.mocked(application.get('IpcApiService').broadcast)
}

function modelScopeCachePath(file: string): string {
  return `${MODEL_DIR}/master/${file}`
}

/** The simulated on-disk tree, shared by the existsSync probe and the rm below. */
let cachedPaths = new Set<string>()

function mockCacheFiles(files: string[]): void {
  cachedPaths = new Set(files)
  existsSync.mockImplementation((candidate) => cachedPaths.has(String(candidate)))
}

/** Recursive rm that actually prunes the simulated tree, so a test asserting the weights
 * survived a failure cannot pass just because the probe was pinned to a stale file list. */
function mockRecursiveRm(target: unknown): Promise<void> {
  const root = String(target)
  for (const path of cachedPaths) {
    if (path === root || path.startsWith(`${root}/`)) cachedPaths.delete(path)
  }
  return Promise.resolve()
}

describe('LocalEmbeddingDownloadService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    acquireEmbeddingModelRemovalGuard.mockReturnValue(releaseRemovalGuard)
    rm.mockImplementation(mockRecursiveRm)
    isInChina.mockResolvedValue(false)
    onnxRuntimeIsReady.mockReturnValue(true)
    ensureOnnxRuntime.mockResolvedValue(undefined)
    // clearAllMocks keeps implementations — reset the cache probe so one test's
    // on-disk layout cannot leak into the next (mirror order consults the cache).
    mockCacheFiles([])
  })

  describe('ready probe', () => {
    const requiredFiles = ['config.json', 'tokenizer_config.json', 'tokenizer.json', `onnx/${READY_FILE}`]

    it('reports ready for the HuggingFace main-revision cache layout', () => {
      mockCacheFiles([
        MODEL_DIR,
        `${MODEL_DIR}/config.json`,
        `${MODEL_DIR}/tokenizer_config.json`,
        `${MODEL_DIR}/tokenizer.json`,
        `${MODEL_DIR}/onnx/${READY_FILE}`
      ])

      expect(localEmbeddingDownloadService.getStatus()).toBe('ready')
    })

    it('reports ready for the ModelScope master-revision cache layout', () => {
      mockCacheFiles([MODEL_DIR, ...requiredFiles.map(modelScopeCachePath)])

      expect(localEmbeddingDownloadService.getStatus()).toBe('ready')
    })

    it('reports not_downloaded when the cache dir is absent', () => {
      mockCacheFiles([])

      expect(localEmbeddingDownloadService.getStatus()).toBe('not_downloaded')
    })

    it('reports error when only the quantized weights exist', () => {
      mockCacheFiles([MODEL_DIR, `${MODEL_DIR}/onnx/${READY_FILE}`])

      expect(localEmbeddingDownloadService.getStatus()).toBe('error')
    })

    it('tells the card WHY via the incomplete_cache error code', () => {
      mockCacheFiles([MODEL_DIR, `${MODEL_DIR}/config.json`])

      expect(localEmbeddingDownloadService.getStatusInfo()).toEqual({ status: 'error', errorCode: 'incomplete_cache' })
    })

    it('does not combine files from different revisions into a ready cache', () => {
      mockCacheFiles([
        MODEL_DIR,
        `${MODEL_DIR}/config.json`,
        `${MODEL_DIR}/tokenizer.json`,
        modelScopeCachePath('tokenizer_config.json'),
        modelScopeCachePath(`onnx/${READY_FILE}`)
      ])

      expect(localEmbeddingDownloadService.getStatus()).toBe('error')
    })

    it('logs an incomplete cache once with the missing files', () => {
      // Reset the hot-probe warning guard in case a preceding test left an incomplete cache.
      mockCacheFiles([])
      expect(localEmbeddingDownloadService.getStatus()).toBe('not_downloaded')
      vi.clearAllMocks()

      mockCacheFiles([MODEL_DIR, `${MODEL_DIR}/config.json`])

      expect(localEmbeddingDownloadService.getStatus()).toBe('error')
      expect(localEmbeddingDownloadService.getStatus()).toBe('error')
      expect(mockMainLoggerService.warn).toHaveBeenCalledTimes(1)
      expect(mockMainLoggerService.warn).toHaveBeenCalledWith(
        'local embedding model cache is incomplete',
        expect.objectContaining({
          missingFiles: expect.arrayContaining([`${MODEL_DIR}/tokenizer.json`, modelScopeCachePath('config.json')])
        })
      )
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

  describe('mirror fallback', () => {
    /** `remoteHost` of the source the Nth loadEmbedding attempt was given. */
    function attemptedHost(index: number): string {
      return loadEmbedding.mock.calls[index][0].remoteHost
    }

    it('tries the region-default mirror first: HuggingFace when not in China', async () => {
      await localEmbeddingDownloadService.download()

      expect(loadEmbedding).toHaveBeenCalledTimes(1)
      expect(attemptedHost(0)).toContain('huggingface.co')
    })

    it('prefers the mirror whose cache is already complete over the region default', async () => {
      // Runtime-only repair: complete HuggingFace weights on disk (only the shared
      // onnxruntime binary was missing), while the region signal now says China. The
      // cached revision must be tried first — the region-default mirror would miss
      // the other revision's cache key and re-download the ~600MB weights.
      isInChina.mockResolvedValue(true)
      mockCacheFiles([
        MODEL_DIR,
        `${MODEL_DIR}/config.json`,
        `${MODEL_DIR}/tokenizer_config.json`,
        `${MODEL_DIR}/tokenizer.json`,
        `${MODEL_DIR}/onnx/${READY_FILE}`
      ])
      onnxRuntimeIsReady.mockReturnValue(false)
      ensureOnnxRuntime.mockImplementationOnce(async () => {
        onnxRuntimeIsReady.mockReturnValue(true)
      })

      expect(localEmbeddingDownloadService.getStatus()).toBe('not_downloaded')

      await expect(localEmbeddingDownloadService.download()).resolves.toBe('ready')

      expect(ensureOnnxRuntime).toHaveBeenCalledTimes(1)
      expect(loadEmbedding).toHaveBeenCalledTimes(1)
      expect(attemptedHost(0)).toContain('huggingface.co')
    })

    it('tries ModelScope first when the region signal reports China', async () => {
      isInChina.mockResolvedValue(true)

      await localEmbeddingDownloadService.download()

      expect(attemptedHost(0)).toContain('modelscope.cn')
    })

    it('falls back to the other mirror when the region default is unreachable', async () => {
      // The egress-IP region signal is a guess — a proxied China user reads as overseas
      // and gets HuggingFace, which the worker often cannot reach. ModelScope must still
      // get its turn instead of the whole download failing.
      loadEmbedding.mockRejectedValueOnce(new Error('fetch failed'))

      await expect(localEmbeddingDownloadService.download()).resolves.toBe('ready')

      expect(loadEmbedding).toHaveBeenCalledTimes(2)
      expect(attemptedHost(1)).toContain('modelscope.cn')
      expect(broadcastSpy()).toHaveBeenCalledWith(
        'local_model.download_progress',
        expect.objectContaining({ status: 'ready', percent: 100 })
      )
    })

    it('reports every mirror error once all mirrors are exhausted', async () => {
      const huggingFaceError = new Error('huggingface unreachable')
      const modelScopeError = new Error('modelscope unreachable')
      loadEmbedding.mockRejectedValueOnce(huggingFaceError)
      loadEmbedding.mockRejectedValueOnce(modelScopeError)

      const error = await localEmbeddingDownloadService.download().catch((caught) => caught)

      expect(error).toBeInstanceOf(AggregateError)
      expect(error.message).toContain('huggingface: huggingface unreachable')
      expect(error.message).toContain('modelscope: modelscope unreachable')
      expect(error.errors).toHaveLength(2)
      expect(error.errors[0]).toMatchObject({ message: 'huggingface: huggingface unreachable' })
      expect(error.errors[1]).toMatchObject({ message: 'modelscope: modelscope unreachable' })
      expect(error.errors[0].cause).toBe(huggingFaceError)
      expect(error.errors[1].cause).toBe(modelScopeError)
      expect(loadEmbedding).toHaveBeenCalledTimes(2)
      expect(broadcastSpy()).toHaveBeenCalledWith(
        'local_model.download_progress',
        expect.objectContaining({ status: 'error', errorCode: 'download_failed' })
      )
    })

    it('does not try the next mirror after a user cancel', async () => {
      loadEmbedding.mockImplementation((_source, _repo, _dtype, _onProgress, signal: AbortSignal) => {
        localEmbeddingDownloadService.cancel()
        return Promise.reject(signal.reason ?? new Error('aborted'))
      })

      await expect(localEmbeddingDownloadService.download()).resolves.toBe('cancelled')

      // Retrying a cancelled download on the fallback mirror would resurrect the very
      // transfer the user just stopped.
      expect(loadEmbedding).toHaveBeenCalledTimes(1)
      expect(rm).not.toHaveBeenCalled()
    })
  })

  describe('failure cleanup', () => {
    /** A complete HuggingFace-layout cache, i.e. weights an earlier download finished. */
    const completeWeights = [
      MODEL_DIR,
      `${MODEL_DIR}/config.json`,
      `${MODEL_DIR}/tokenizer_config.json`,
      `${MODEL_DIR}/tokenizer.json`,
      `${MODEL_DIR}/onnx/${READY_FILE}`
    ]

    /** Complete weights, but the shared onnxruntime binary is gone — the state that makes
     * modelFilesState() report `absent` and the card offer Download for a runtime-only repair. */
    function mockRuntimeOnlyRepairState(): void {
      mockCacheFiles(completeWeights)
      onnxRuntimeIsReady.mockReturnValue(false)
    }

    it('keeps the complete weights when the runtime-only repair fails', async () => {
      // performDownload fetches the onnxruntime binary before it touches the weights, so a
      // registry/checksum failure here happens with the ~600MB model still untouched on disk.
      // Wiping the model root would make a ~40MB runtime failure cost a full re-download.
      mockRuntimeOnlyRepairState()
      ensureOnnxRuntime.mockRejectedValueOnce(new Error('every registry mirror failed'))

      await expect(localEmbeddingDownloadService.download()).rejects.toThrow('every registry mirror failed')

      expect(loadEmbedding).not.toHaveBeenCalled()
      expect(rm).not.toHaveBeenCalled()
    })

    it('keeps the complete weights when the runtime-only repair is cancelled', async () => {
      mockRuntimeOnlyRepairState()
      ensureOnnxRuntime.mockImplementationOnce(async () => {
        localEmbeddingDownloadService.cancel()
        throw new Error('aborted')
      })

      await expect(localEmbeddingDownloadService.download()).resolves.toBe('cancelled')

      expect(rm).not.toHaveBeenCalled()
    })

    it('leaves those weights usable once the runtime is repaired on a later run', async () => {
      mockRuntimeOnlyRepairState()
      ensureOnnxRuntime.mockRejectedValueOnce(new Error('every registry mirror failed'))
      await expect(localEmbeddingDownloadService.download()).rejects.toThrow()

      // A fresh instance stands in for an app restart, which clears the in-memory
      // last-failure flag that otherwise pins the card to `error` for the rest of the run.
      vi.resetModules()
      const restarted = (await import('../LocalEmbeddingDownloadService')).localEmbeddingDownloadService
      onnxRuntimeIsReady.mockReturnValue(true)

      expect(restarted.getStatus()).toBe('ready')
    })

    it('keeps whatever is on disk when every mirror fails', async () => {
      // transformers.js renames a cache entry into place only once the file has fully
      // downloaded, so an exhausted-mirror failure leaves no partials to clean up.
      loadEmbedding.mockRejectedValueOnce(new Error('huggingface unreachable'))
      loadEmbedding.mockRejectedValueOnce(new Error('modelscope unreachable'))

      await expect(localEmbeddingDownloadService.download()).rejects.toBeInstanceOf(AggregateError)

      expect(rm).not.toHaveBeenCalled()
    })
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
