import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { inferenceHost, type InferenceProgress } from '@main/ai/inference/InferenceHost'
import {
  currentModelSource,
  MODEL_DTYPE,
  MODEL_REPO
} from '@main/ai/provider/custom/localEmbedding/localEmbeddingRuntime'
import type { LocalModelStatus } from '@shared/data/presets/localEmbedding'

const logger = loggerService.withContext('LocalEmbeddingDownloadService')

/** q8 weights file for {@link MODEL_REPO}; its presence marks the model cached. */
const MODEL_FILE = 'model_quantized.onnx'

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
 * Manages the on-disk lifecycle of the local embedding model: status probe,
 * download (delegated to the inference worker, with progress broadcast to the
 * renderer), cancel, and remove. Stateless across restarts — the source of truth
 * is the cache directory on disk, not memory.
 */
class LocalEmbeddingDownloadService {
  private downloading = false
  private abortController: AbortController | null = null

  private modelDir(): string {
    return path.join(application.getPath('feature.embedding.models'), ...MODEL_REPO.split('/'))
  }

  getStatus(): LocalModelStatus {
    if (this.downloading) return 'downloading'
    return containsFile(this.modelDir(), MODEL_FILE) ? 'ready' : 'not_downloaded'
  }

  async download(): Promise<void> {
    if (this.downloading) return
    this.downloading = true
    this.abortController = new AbortController()
    try {
      await inferenceHost.loadEmbedding(
        currentModelSource(),
        MODEL_REPO,
        MODEL_DTYPE,
        (p) => this.broadcastProgress(p),
        this.abortController.signal
      )
      this.broadcast({ status: 'ready', percent: 100 })
    } catch (error) {
      logger.error('local embedding download failed', error as Error)
      this.broadcast({ status: 'error', percent: 0 })
      throw error
    } finally {
      this.downloading = false
      this.abortController = null
    }
  }

  cancel(): void {
    this.abortController?.abort(new Error('download cancelled'))
    // The worker may be mid-fetch; terminating it stops the download immediately.
    inferenceHost.terminate()
  }

  async remove(): Promise<void> {
    // Unload the worker first so the weights file isn't held open while we delete it.
    inferenceHost.terminate()
    await fs.promises.rm(this.modelDir(), { recursive: true, force: true })
  }

  private broadcastProgress(p: InferenceProgress): void {
    // transformers.js reports progress per file, and the small config/tokenizer
    // files each sweep 0→100 before the weights even start downloading — a naive
    // bar driven by every file jumps around. The .onnx weights are ~99% of the
    // 614MB download, so drive the bar off that file alone for smooth, monotonic
    // progress; the tiny sidecar files finish in the first moments at 0%.
    if (typeof p.file !== 'string' || !p.file.endsWith('.onnx')) return
    const percent =
      typeof p.progress === 'number'
        ? Math.round(p.progress)
        : p.total
          ? Math.round(((p.loaded ?? 0) / p.total) * 100)
          : 0
    this.broadcast({ status: p.status, percent, loaded: p.loaded, total: p.total, file: p.file })
  }

  private broadcast(payload: {
    status: string
    percent: number
    loaded?: number
    total?: number
    file?: string
  }): void {
    application.get('IpcApiService').broadcast('local_model.download_progress', { model: 'embedding', ...payload })
  }
}

export const localEmbeddingDownloadService = new LocalEmbeddingDownloadService()
