import type { InferenceModelSource } from './inferenceProtocol'

/**
 * Download sources for the local ONNX models. ModelScope mirrors the HuggingFace
 * repos under a `models/` path prefix and defaults its branch to `master` (HF
 * uses `main`); both expose the HF-compatible `/resolve/{revision}/` route,
 * so switching source is just three transformers.js env values.
 */
export type ModelSourceId = 'huggingface' | 'modelscope'

const SOURCES: Record<ModelSourceId, InferenceModelSource> = {
  huggingface: {
    remoteHost: 'https://huggingface.co',
    remotePathTemplate: '{model}/resolve/{revision}',
    revision: 'main'
  },
  modelscope: {
    remoteHost: 'https://www.modelscope.cn',
    remotePathTemplate: 'models/{model}/resolve/{revision}',
    revision: 'master'
  }
}

export function getModelSource(id: ModelSourceId): InferenceModelSource {
  return SOURCES[id]
}

/** Chinese locales default to ModelScope (HuggingFace is hard to reach in China). */
export function defaultModelSourceId(locale: string): ModelSourceId {
  return locale.toLowerCase().startsWith('zh') ? 'modelscope' : 'huggingface'
}
