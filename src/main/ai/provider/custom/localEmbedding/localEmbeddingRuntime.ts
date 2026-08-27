import { application } from '@application'
import type { EmbeddingModelDir } from '@main/ai/localModel'
import { bundleDtype, bundleForCapability, localModelRegistry } from '@main/ai/localModel'

/**
 * The installed model's directory, for loading it straight off disk. Resolving it in the
 * main process — where the on-disk scan already lives — means a missing model fails here
 * with a clear message instead of as a transformers.js resolution error in the worker.
 */
export function currentModelDir(): EmbeddingModelDir {
  const modelDir = localModelRegistry.resolveInstalledDir(bundleForCapability('embedding'))
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
    .embed(texts, currentModelDir(), bundleDtype(bundleForCapability('embedding')), signal)
}
