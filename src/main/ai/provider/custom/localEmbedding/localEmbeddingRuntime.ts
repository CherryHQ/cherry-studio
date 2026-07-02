import { inferenceHost } from '@main/ai/inference/InferenceHost'
import { LOCAL_MODELS } from '@main/ai/inference/localModelCatalog'
import { defaultModelSourceId, getModelSource } from '@main/ai/inference/modelSource'
import { app } from 'electron'

/** Default download source, picked from the app locale (zh → ModelScope). */
export function currentModelSource() {
  return getModelSource(defaultModelSourceId(app.getLocale()))
}

/**
 * Embed texts on the inference worker (off the main thread). Pooling and
 * normalization run inside the worker; this is a thin main-process entry point.
 * The first call downloads the model if it is not cached yet.
 */
export async function embedTexts(texts: string[], signal?: AbortSignal): Promise<number[][]> {
  if (texts.length === 0) return []
  const { repo, dtype } = LOCAL_MODELS.embedding
  return inferenceHost.embed(texts, currentModelSource(), repo, dtype, signal)
}
