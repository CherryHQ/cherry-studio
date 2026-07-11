import { application } from '@application'
import { LOCAL_MODELS } from '@main/ai/inference/localModelCatalog'
import { defaultModelSourceId, getModelSource } from '@main/ai/inference/modelSource'
import { regionService } from '@main/services/RegionService'

/** Default download source, picked from the egress region (China → ModelScope) — same signal BinaryManager uses for its mirrors. */
export async function currentModelSource() {
  const inChina = await regionService.isInChina().catch(() => false)
  return getModelSource(defaultModelSourceId(inChina))
}

/**
 * Embed texts on the inference worker (off the main thread). Pooling and
 * normalization run inside the worker; this is a thin main-process entry point.
 * The first call downloads the model if it is not cached yet.
 */
export async function embedTexts(texts: string[], signal?: AbortSignal): Promise<number[][]> {
  if (texts.length === 0) return []
  const { repo, dtype } = LOCAL_MODELS.embedding
  return application.get('EmbeddingInferenceService').embed(texts, await currentModelSource(), repo, dtype, signal)
}
