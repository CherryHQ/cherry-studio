import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { inferenceHost, type InferenceProgress } from '@main/ai/inference/InferenceHost'
import { LOCAL_MODELS } from '@main/ai/inference/localModelCatalog'
import { currentModelSource } from '@main/ai/provider/custom/localEmbedding/localEmbeddingRuntime'
import {
  registerLocalEmbeddingModel,
  unregisterLocalEmbeddingModelIfUnused
} from '@main/features/localModel/localEmbeddingRegistration'
import { LocalModelDownloadService } from '@main/features/localModel/LocalModelDownloadService'
import type { LocalModelKind } from '@shared/data/presets/localModel'

/** Repo / quantization / ready-probe file for the local embedding model. */
const { repo: MODEL_REPO, dtype: MODEL_DTYPE, readyFile: MODEL_FILE } = LOCAL_MODELS.embedding

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

  private modelDir(): string {
    return path.join(application.getPath('feature.embedding.models'), ...MODEL_REPO.split('/'))
  }

  protected isReady(): boolean {
    return containsFile(this.modelDir(), MODEL_FILE)
  }

  protected async performDownload(signal: AbortSignal): Promise<void> {
    await inferenceHost.loadEmbedding(
      currentModelSource(),
      MODEL_REPO,
      MODEL_DTYPE,
      (p) => this.broadcastProgress(p),
      signal
    )
    // Now that the weights are on disk, register the provider/model so the KB
    // embedding picker lists it (lazy equivalent of the old boot seeder).
    await registerLocalEmbeddingModel()
    this.broadcast({ status: 'ready', percent: 100 })
  }

  override cancel(): void {
    super.cancel()
    // The worker may be mid-fetch; terminating it stops the download immediately.
    inferenceHost.terminate()
  }

  async remove(): Promise<{ removed: boolean }> {
    const { removed } = await unregisterLocalEmbeddingModelIfUnused()
    if (!removed) {
      // A knowledge base still references the model. Keep the weights too — deleting
      // them would leave that base pointing at a model whose files are gone, breaking
      // re-index / add-document (or forcing a surprise 600MB re-download).
      return { removed: false }
    }
    // Unload the worker first so the weights file isn't held open while we delete it.
    inferenceHost.terminate()
    await fs.promises.rm(this.modelDir(), { recursive: true, force: true })
    return { removed: true }
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
}

export const localEmbeddingDownloadService = new LocalEmbeddingDownloadService()
