import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import type { InferenceProgress } from '@main/ai/inference/InferenceServiceBase'
import { LOCAL_MODELS } from '@main/ai/inference/localModelCatalog'
import { currentModelSource } from '@main/ai/provider/custom/localEmbedding/localEmbeddingRuntime'
import type { LocalModelKind, LocalModelStatus } from '@shared/data/presets/localModel'

import { registerLocalEmbeddingModel, unregisterLocalEmbeddingModelIfUnused } from './localEmbeddingRegistration'
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

  /** True while {@link remove} is past its successful unregister but the weights
   * are still on disk (worker teardown + rm in flight). {@link checkStatus}'s
   * self-heal must not run in this window — it would re-create the user_model
   * row that remove() just deleted, leaving a row pointing at weights that
   * vanish moments later (the exact FK trap the heal exists to prevent). */
  private removing = false

  /** In-flight removal, if any — concurrent {@link remove} calls join it. */
  private removal: Promise<{ removed: boolean }> | null = null

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

  override async checkStatus(): Promise<LocalModelStatus> {
    const status = this.getStatus()
    if (status !== 'ready') return status
    // Mid-removal the weights still read as ready but the row is already gone
    // by design — report the state the removal is converging to instead of
    // healing against it.
    if (this.removing) return 'not_downloaded'
    // The download/remove paths keep "weights on disk ⟺ user_model row" in
    // sync, but the DB can be reset underneath the weights (a factory reset
    // keeps Runtime/Toolchain, a restored backup may predate the download).
    // Re-registering is idempotent and cheap, and it runs before `ready` is
    // reported — so a consumer acting on `ready` (the KB dialog inserts the
    // fixed model id as an embeddingModelId FK) always finds the row.
    await registerLocalEmbeddingModel()
    return status
  }

  protected async performDownload(signal: AbortSignal): Promise<void> {
    await onnxRuntimeBinaryService.ensure(signal, (fraction) => {
      this.broadcast({ status: 'downloading', percent: Math.round(fraction * ONNXRUNTIME_PERCENT) })
    })
    const source = await currentModelSource()
    await application
      .get('EmbeddingInferenceService')
      .loadEmbedding(source, MODEL_REPO, MODEL_DTYPE, (p) => this.broadcastProgress(p), signal)
    // Now that the weights are on disk, register the provider/model so the KB
    // embedding picker lists it (lazy equivalent of the old boot seeder).
    await registerLocalEmbeddingModel()
    this.broadcast({ status: 'ready', percent: 100 })
  }

  protected override async cleanupAfterError(): Promise<void> {
    // A failed or cancelled download must not leave weights that read as `ready` while the
    // user_model row is missing (e.g. loadEmbedding succeeded but registration failed, or a
    // cancel left partials). Otherwise get_status reports the leftover weights as ready and
    // selecting the model in the KB picker would trip the embeddingModelId FK. Release the
    // worker first (loadEmbedding caches the pipeline, holding the weights open on Windows),
    // then drop the partial/unregistered weights. terminateThen blocks a request queued
    // behind the in-flight one from respawning a worker mid-delete (it would otherwise
    // start reading/writing the very files being removed).
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
    // Coalesce concurrent removes onto the in-flight one: a second pass would
    // re-run unregister/rm mid-teardown, and its `finally` would end the
    // `removing` suppression window while the first delete is still running.
    if (!this.removal) {
      this.removal = this.performRemove().finally(() => {
        this.removal = null
      })
    }
    return this.removal
  }

  private async performRemove(): Promise<{ removed: boolean }> {
    const { removed } = await unregisterLocalEmbeddingModelIfUnused()
    if (!removed) {
      // A knowledge base still references the model. Keep the weights too — deleting
      // them would leave that base pointing at a model whose files are gone, breaking
      // re-index / add-document (or forcing a surprise 600MB re-download).
      return { removed: false }
    }
    this.removing = true
    try {
      // Unload the worker first so the weights file isn't held open while we delete it.
      // terminateThen also blocks a request queued behind it from respawning a worker
      // mid-delete (it would otherwise start reading/writing the very files being removed).
      await application
        .get('EmbeddingInferenceService')
        .terminateThen(() => fs.promises.rm(this.modelsRootDir(), { recursive: true, force: true }))
    } catch (error) {
      // The row is gone but the weights survived (e.g. terminate() rejected, or a Windows
      // lock on rm()). Re-register so "files present ⟺ user_model row present" holds —
      // otherwise get_status would report the leftover weights as `ready` and selecting the
      // model would trip the knowledge_base.embeddingModelId FK. Log the error first so the
      // breadcrumb survives even if the re-register itself throws over the rethrow below.
      logger.warn(
        'failed to unload worker or delete embedding weights on removal; re-registering to keep files and row consistent',
        error as Error
      )
      await registerLocalEmbeddingModel()
      throw error
    } finally {
      this.removing = false
    }
    return { removed: true }
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
    // empty for the moment between the last byte and the 'ready' emitted after
    // registration (the download's visible "100% → 0%" flicker).
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
