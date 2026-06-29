import { inferenceHost } from '@main/ai/inference/InferenceHost'
import { defaultModelSourceId, getModelSource } from '@main/ai/inference/modelSource'
import { app } from 'electron'

/** HF ONNX community repo + quantization variant for the local embedding model. */
export const MODEL_REPO = 'onnx-community/Qwen3-Embedding-0.6B-ONNX'
export const MODEL_DTYPE = 'q8'

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
  return inferenceHost.embed(texts, currentModelSource(), MODEL_REPO, MODEL_DTYPE, signal)
}
