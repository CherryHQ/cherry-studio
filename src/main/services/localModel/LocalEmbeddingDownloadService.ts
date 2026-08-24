import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { loggerService } from '@logger'
import type { InferenceProgress } from '@main/ai/inference/InferenceServiceBase'
import { LOCAL_MODELS } from '@main/ai/inference/localModelCatalog'
import {
  ALL_MODEL_SOURCE_IDS,
  getModelSource,
  type ModelSourceId,
  modelSourceOrder
} from '@main/ai/inference/modelSource'
import { regionService } from '@main/services/RegionService'
import { LOCAL_EMBEDDING_UNIQUE_MODEL_ID } from '@shared/data/presets/localEmbedding'
import type { LocalModelKind } from '@shared/data/presets/localModel'

import { LocalModelDownloadService, type LocalModelFilesState } from './LocalModelDownloadService'
import { onnxRuntimeBinaryService } from './OnnxRuntimeBinaryService'

const logger = loggerService.withContext('LocalEmbeddingDownloadService')

/** Repo / quantization / ready-probe files for the local embedding model. */
const { repo: MODEL_REPO, dtype: MODEL_DTYPE, readyFile: MODEL_FILE } = LOCAL_MODELS.embedding
const REQUIRED_MODEL_FILES = ['config.json', 'tokenizer_config.json', 'tokenizer.json', path.join('onnx', MODEL_FILE)]

interface LocalEmbeddingCacheProbe {
  state: LocalModelFilesState
  /** The source whose revision cache is complete — only set when state is 'ready'. */
  completeSource?: ModelSourceId
  /** That revision's cache directory, i.e. the one holding `config.json` — only set when
   * state is 'ready'. Inference loads the model straight from this path. */
  completeDir?: string
  missingFiles: string[]
}

/**
 * Share of the progress bar reserved for the onnxruntime binary phase; the 614MB
 * model weights own the rest. Both phases must map onto this one scale — the
 * weights' own 0–100 starts where the binary's slice ends — or the bar snaps
 * backwards at the phase boundary.
 */
const ONNXRUNTIME_PERCENT = 10

function sourceCacheDir(modelDir: string, sourceId: ModelSourceId): string {
  // transformers.js FileCache omits the revision segment for `main`, but includes it
  // otherwise (buildResourcePaths in @huggingface/transformers/src/utils/hub.js).
  const { revision } = getModelSource(sourceId)
  return revision === 'main' ? modelDir : path.join(modelDir, revision)
}

function missingModelFiles(sourceDir: string): string[] {
  return REQUIRED_MODEL_FILES.map((file) => path.join(sourceDir, file)).filter((file) => !fs.existsSync(file))
}

function cacheState(modelDir: string): LocalEmbeddingCacheProbe {
  if (!fs.existsSync(modelDir)) return { state: 'absent', missingFiles: [] }

  const missingFiles: string[] = []
  for (const sourceId of ALL_MODEL_SOURCE_IDS) {
    const sourceDir = sourceCacheDir(modelDir, sourceId)
    const sourceMissingFiles = missingModelFiles(sourceDir)
    if (sourceMissingFiles.length === 0) {
      return { state: 'ready', completeSource: sourceId, completeDir: sourceDir, missingFiles: [] }
    }
    missingFiles.push(...sourceMissingFiles)
  }
  return { state: 'incomplete', missingFiles }
}

/**
 * On-disk lifecycle of the local embedding model. The download itself is
 * delegated to the inference worker (transformers.js); the shared
 * downloading/abort/broadcast machinery lives in {@link LocalModelDownloadService}.
 */
class LocalEmbeddingDownloadService extends LocalModelDownloadService {
  protected readonly kind: LocalModelKind = 'embedding'
  private incompleteCacheLogged = false

  /** The dedicated cache root for this one model (`models/qwen3-embedding`). Cleanup
   * and removal target this rather than the nested repo dir so no empty
   * `onnx-community/` parent chain is left behind. */
  private modelsRootDir(): string {
    return application.getPath('feature.embedding.models')
  }

  private modelDir(): string {
    return path.join(this.modelsRootDir(), ...MODEL_REPO.split('/'))
  }

  /**
   * Absolute directory of the complete on-disk cache, or null when no revision is complete.
   * Inference loads the model from this path rather than by repo id, so the probe that
   * already knows which revision layout is complete stays the single owner of that fact —
   * the worker no longer re-derives it by trying each mirror's cache key in turn.
   */
  completeCacheDir(): string | null {
    return cacheState(this.modelDir()).completeDir ?? null
  }

  protected modelFilesState(): LocalModelFilesState {
    const probe = cacheState(this.modelDir())
    if (probe.state !== 'incomplete') {
      this.incompleteCacheLogged = false
      // Complete weights without the shared onnxruntime binary read as 'absent', not an
      // error: Download re-fetches only the binary (transformers.js finds the cached
      // weights), so the card must offer Download rather than a false failure.
      return probe.state === 'ready' && !onnxRuntimeBinaryService.isReady() ? 'absent' : probe.state
    }
    if (!this.incompleteCacheLogged) {
      logger.warn('local embedding model cache is incomplete', { missingFiles: probe.missingFiles })
      this.incompleteCacheLogged = true
    }
    return 'incomplete'
  }

  protected async performDownload(signal: AbortSignal): Promise<void> {
    await onnxRuntimeBinaryService.ensure(signal, (fraction) => {
      this.broadcast({ status: 'downloading', percent: Math.round(fraction * ONNXRUNTIME_PERCENT) })
    })
    await this.loadFromFirstReachableMirror(signal)
    this.broadcast({ status: 'ready', percent: 100 })
  }

  /**
   * Try each mirror in order — the same fallback the OCR weights already get in
   * LocalOcrDownloadService.downloadFile. A source whose revision cache is already
   * complete goes first regardless of region: transformers.js resolves it entirely
   * from disk, which is what makes a runtime-only repair re-fetch nothing — a
   * region-ordered attempt would miss the other revision's cache key and re-download
   * the ~600MB weights. After that, region default first: the region signal is an
   * egress-IP guess, so one unreachable mirror must not be terminal (a proxied China
   * user reads as overseas and gets HuggingFace, which may still be unreachable).
   * transformers.js caches a file only once it has fully downloaded, so a failed mirror
   * leaves no partial weights for the next one to trip over.
   */
  private async loadFromFirstReachableMirror(signal: AbortSignal): Promise<void> {
    const inChina = await regionService.isInChina().catch(() => false)
    const { completeSource } = cacheState(this.modelDir())
    const regionOrder = modelSourceOrder(inChina)
    const sourceOrder = completeSource
      ? [completeSource, ...regionOrder.filter((id) => id !== completeSource)]
      : regionOrder
    const failures: Array<{ source: ModelSourceId; error: Error }> = []
    for (const id of sourceOrder) {
      try {
        await application
          .get('EmbeddingInferenceService')
          .loadEmbedding(getModelSource(id), MODEL_REPO, MODEL_DTYPE, (p) => this.broadcastProgress(p), signal)
        // A resolved load doesn't prove the files landed: confirm with the same on-disk probe
        // the card reads, or ready/incomplete flip forever and re-download the ~600MB weights.
        const missingFiles = missingModelFiles(sourceCacheDir(this.modelDir(), id))
        if (missingFiles.length > 0) {
          throw new Error(`the download left the cache incomplete (missing ${missingFiles.join(', ')})`)
        }
        return
      } catch (error) {
        if (signal.aborted) throw error
        const mirrorError = error instanceof Error ? error : new Error(String(error))
        failures.push({ source: id, error: mirrorError })
        logger.warn('embedding model mirror failed', mirrorError, { source: id })
      }
    }
    const errors = failures.map(({ source, error }) => new Error(`${source}: ${error.message}`, { cause: error }))
    throw new AggregateError(
      errors,
      `failed to download the local embedding model from every mirror (${errors.map((error) => error.message).join('; ')})`,
      { cause: errors[0] }
    )
  }

  protected override async cleanupAfterError(): Promise<void> {
    // Release the worker — nothing on disk to clean. transformers.js writes every cache
    // entry through a temp file it renames only once the download completes (and unlinks
    // on failure), so a failed download leaves no partial weights; see the same invariant
    // relied on by loadFromFirstReachableMirror. Deleting here would instead destroy the
    // *complete* weights a runtime-only repair never touched — a failed ~40MB onnxruntime
    // fetch would cost the user the cached ~600MB model.
    await application.get('EmbeddingInferenceService').terminate()
  }

  override cancel(): void {
    super.cancel()
    // The worker may be mid-fetch; terminating it stops the download immediately.
    // Fire-and-forget — cancel doesn't delete files, so it doesn't need to wait
    // for the actual OS-level teardown the way cleanupAfterError/remove do.
    void application.get('EmbeddingInferenceService').terminate()
  }

  async remove(): Promise<{ removed: boolean }> {
    const releaseGuard = knowledgeBaseService.acquireEmbeddingModelRemovalGuard(LOCAL_EMBEDDING_UNIQUE_MODEL_ID)
    if (!releaseGuard) {
      logger.info('Skipped local embedding weight removal because the model is in use or already being removed')
      return { removed: false }
    }

    try {
      // Unload the worker first so the weights file isn't held open while we delete it.
      await application
        .get('EmbeddingInferenceService')
        .terminateThen(() => fs.promises.rm(this.modelsRootDir(), { recursive: true, force: true }))
      return { removed: true }
    } finally {
      releaseGuard()
    }
  }

  private broadcastProgress(p: InferenceProgress): void {
    // transformers.js reports progress per file, and the small config/tokenizer
    // files each sweep 0→100 before the weights even start downloading — a naive
    // bar driven by every file jumps around. The .onnx weights are ~99% of the
    // 614MB download, so drive the bar off that file alone for smooth, monotonic
    // progress; the tiny sidecar files finish in the first moments at 0%.
    if (typeof p.file !== 'string' || !p.file.endsWith('.onnx')) return
    // transformers.js brackets the file's byte stream with dataless 'initiate'/'done'
    // events (no loaded/total/progress). Only compute a percent from the events that
    // actually carry data: map the terminal 'done' to a full bar and drop the empty
    // leading events. Falling through to 0 for 'done' used to snap the full bar back to
    // empty for the moment between the last byte and the terminal 'ready'
    // (the download's visible "100% → 0%" flicker).
    let rawPercent: number
    if (typeof p.progress === 'number') {
      rawPercent = p.progress
    } else if (p.total) {
      rawPercent = ((p.loaded ?? 0) / p.total) * 100
    } else if (p.status === 'done') {
      rawPercent = 100
    } else {
      return
    }
    // The onnxruntime phase already advanced the bar to ONNXRUNTIME_PERCENT, so
    // map the weights' own 0–100 onto the remaining span. Broadcasting the raw
    // value reset the bar to 0 the moment the weights started streaming.
    const percent = Math.round(ONNXRUNTIME_PERCENT + (rawPercent * (100 - ONNXRUNTIME_PERCENT)) / 100)
    this.broadcast({ status: p.status, percent, loaded: p.loaded, total: p.total, file: p.file })
  }
}

export const localEmbeddingDownloadService = new LocalEmbeddingDownloadService()
