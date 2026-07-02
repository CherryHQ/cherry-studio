import type { InferenceModelSource } from './inferenceProtocol'

/**
 * Download mirrors for local models (embedding + OCR). HuggingFace and its
 * ModelScope mirror both expose the HF-compatible `/<repo>/resolve/<revision>/<file>`
 * route; ModelScope nests repos under `models/` and defaults its branch to
 * `master` (HF uses `main`). One mirror table feeds two consumers:
 *   - transformers.js (embedding) takes the `{remoteHost, remotePathTemplate,
 *     revision}` triple as env values and fetches the model itself.
 *   - the OCR download service builds explicit per-file URLs from the same table
 *     via {@link resolveModelFileUrl} and fetches the weights directly.
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

/** Mirrors to try in order for `locale`: the locale default first, the other as fallback. */
export function modelSourceOrder(locale: string): ModelSourceId[] {
  return defaultModelSourceId(locale) === 'modelscope' ? ['modelscope', 'huggingface'] : ['huggingface', 'modelscope']
}

/**
 * Direct download URL for `<repo>/<file>` on a given mirror, e.g.
 * `https://huggingface.co/PaddlePaddle/PP-OCRv6_medium_det_onnx/resolve/main/inference.onnx`.
 * Used for manually-fetched model files (OCR); embedding lets transformers.js
 * build its own URLs from the env triple.
 */
export function resolveModelFileUrl(id: ModelSourceId, repo: string, file: string, revision?: string): string {
  const source = SOURCES[id]
  const repoPath = source.remotePathTemplate.replace('{model}', repo).replace('{revision}', revision ?? source.revision)
  return `${source.remoteHost}/${repoPath}/${file}`
}
