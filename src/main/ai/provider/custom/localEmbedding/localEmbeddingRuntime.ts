import { application } from '@application'

/**
 * Embed texts on the inference worker (off the main thread). Pooling and
 * normalization run inside the worker; this is a thin main-process entry point.
 * Model files must already be downloaded; inference never fetches missing files.
 */
export async function embedTexts(texts: string[], signal?: AbortSignal): Promise<number[][]> {
  if (texts.length === 0) return []
  return application.get('EmbeddingInferenceService').embed(texts, signal)
}
