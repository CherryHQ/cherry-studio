import { application } from '@application'
import type { EmbeddingModelDir } from '@main/ai/inference/inferenceProtocol'
import { LOCAL_MODELS } from '@main/ai/inference/localModelCatalog'
import { localEmbeddingDownloadService } from '@main/services/localModel'

/**
 * The cached model's directory, for loading it straight off disk. Resolving it here — from
 * the download service's own on-disk probe — rather than handing the worker a list of mirror
 * revisions to try means a missing cache fails in the main process with a clear message,
 * instead of surfacing as a transformers.js resolution error per candidate.
 */
export function currentModelDir(): EmbeddingModelDir {
  const modelDir = localEmbeddingDownloadService.completeCacheDir()
  if (!modelDir) {
    throw new Error('the local embedding model is not fully downloaded')
  }
  return modelDir
}

/**
 * Embed texts on the inference worker (off the main thread). Pooling and
 * normalization run inside the worker; this is a thin main-process entry point.
 * Model files must already be downloaded; inference never fetches missing files.
 */
export async function embedTexts(texts: string[], signal?: AbortSignal): Promise<number[][]> {
  if (texts.length === 0) return []
  return application
    .get('EmbeddingInferenceService')
    .embed(texts, currentModelDir(), LOCAL_MODELS.embedding.dtype, signal)
}
