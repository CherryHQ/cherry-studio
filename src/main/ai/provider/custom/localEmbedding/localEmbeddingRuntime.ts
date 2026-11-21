import { application } from '@application'
import { localEmbeddingBundleIdForModelId } from '@shared/data/presets/localEmbedding'

/**
 * Embed texts on the inference worker (off the main thread). Pooling and
 * normalization run inside the worker; this is a thin main-process entry point.
 * Model files must already be downloaded; inference never fetches missing files.
 */
export async function embedTexts(modelId: string, texts: string[], signal?: AbortSignal): Promise<number[][]> {
  if (texts.length === 0) return []
  const bundleId = localEmbeddingBundleIdForModelId(modelId)
  if (!bundleId) throw new Error(`unsupported local embedding model: ${modelId}`)
  return application.get('EmbeddingInferenceService').embed(bundleId, texts, signal)
}
