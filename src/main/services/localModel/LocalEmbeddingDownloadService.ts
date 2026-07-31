import fs from 'node:fs'
import path from 'node:path'

import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'

import { application } from '@application'
import { loggerService } from '@logger'
import type { InferenceProgress } from '@main/ai/inference/InferenceServiceBase'
import { LOCAL_MODELS } from '@main/ai/inference/localModelCatalog'
import { currentModelSource } from '@main/ai/provider/custom/localEmbedding/localEmbeddingRuntime'
import { LOCAL_EMBEDDING_UNIQUE_MODEL_ID } from '@shared/data/presets/localEmbedding'
import type { LocalModelKind } from '@shared/data/presets/localModel'

import { LocalModelDownloadService } from './LocalModelDownloadService'
import { onnxRuntimeBinaryService } from './OnnxRuntimeBinaryService'

const logger = loggerService.withContext('LocalEmbeddingDownloadService')

/** Repo / quantization / ready-probe file for the local embedding model. */
const { repo: MODEL_REPO, dtype: MODEL_DTYPE, readyFile: MODEL_FILE } = LOCAL_MODELS.embedding

/**
 * Share of the progress bar reserved for the onnxruntime binary phase; the 614MB
 * model weights own the rest. Both phases must map onto this one scale — the
 * weights' own 0–100 starts where the binary's slice ends — or the bar snaps
 * backwards at the phase boundary.
 */
const ONNXRUNTIME_PERCENT = 10

/** Whether `fileName` exists anywhere under `dir` (the transformers.js cache layout
 * nests weights under source-specific sub-paths, so we search rather than guess). */
function containsFile(dir: string, fileName: string): boolean {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return false
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (containsFile(path.join(dir, entry.name), fileName)) return true
    } else if (entry.name === fileName) {
      return true
    }
  }
  return false
}

/**
 * On-disk lifecycle of the local embedding model. The download itself is
 * delegated to the inference worker (transformers.js); the shared
 * downloading/abort/broadcast machinery lives in {@link LocalModelDownloadService}.
 */
class LocalEmbeddingDownloadService extends LocalModelDownloadService {
  protected readonly kind: LocalModelKind = 'embedding'

  /** The dedicated cache root for this one model (`models/qwen3-embedding`). Cleanup
   * and removal target this rather than the nested repo dir so no empty
   * `onnx-community/` parent chain is left behind. */
  private modelsRootDir(): string {
    return application.getPath('feature.embedding.models')
  }

  private modelDir(): string {
    return path.join(this.modelsRootDir(), ...MODEL_REPO.split('/'))
  }

  protected isReady(): boolean {
    return onnxRuntimeBinaryService.isReady() && containsFile(this.modelDir(), MODEL_FILE)
  }

  protected async performDownload(signal: AbortSignal): Promise<void> {
    await onnxRuntimeBinaryService.ensure(signal, (fraction) => {
      this.broadcast({ status: 'downloading', percent: Math.round(fraction * ONNXRUNTIME_PERCENT) })
    })
    const source = await currentModelSource()
    await application
      .get('EmbeddingInferenceService')
      .loadEmbedding(source, MODEL_REPO, MODEL_DTYPE, (p) => this.broadcastProgress(p), signal)
    this.broadcast({ status: 'ready', percent: 100 })
  }

  protected override async cleanupAfterError(): Promise<void> {
    // Release the worker first (loadEmbedding caches the pipeline, holding the weights open on
    // Windows), then drop partial weights. terminateThen blocks a request queued behind the
    // in-flight one from respawning a worker mid-delete.
    await application
      .get('EmbeddingInferenceService')
      .terminateThen(() => fs.promises.rm(this.modelsRootDir(), { recursive: true, force: true }))
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
