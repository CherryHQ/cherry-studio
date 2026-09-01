/**
 * Download mirrors for model weights. HuggingFace and its ModelScope mirror both expose
 * the HF-compatible `/<repo>/resolve/<revision>/<file>` route; ModelScope nests repos
 * under `models/` and defaults its branch to `master` (HF uses `main`), which is why the
 * addressing scheme is a table rather than a base URL.
 *
 * Download-time only. Inference never consults it: models load by absolute path, which is
 * what keeps them off the network entirely.
 */
export type ModelSourceId = 'huggingface' | 'modelscope'
export type DownloadSourcePreference = 'china-first' | 'global-first'

interface ModelSource {
  /** e.g. `https://huggingface.co`. */
  remoteHost: string
  /** e.g. `{model}/resolve/{revision}`. */
  remotePathTemplate: string
  /** Branch/tag — `main` on HuggingFace, `master` on ModelScope. */
  revision: string
}

const SOURCES: Record<ModelSourceId, ModelSource> = {
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

/**
 * China-first defaults to ModelScope (HuggingFace is hard to reach in China). The preference
 * is resolved once at the management boundary from the egress region, not from display locale.
 */
export function defaultModelSourceId(preference: DownloadSourcePreference): ModelSourceId {
  return preference === 'china-first' ? 'modelscope' : 'huggingface'
}

/** A permutation of {@link ALL_MODEL_SOURCE_IDS}: the region default first, the other as fallback. */
export function modelSourceOrder(preference: DownloadSourcePreference): [ModelSourceId, ...ModelSourceId[]] {
  return defaultModelSourceId(preference) === 'modelscope'
    ? ['modelscope', 'huggingface']
    : ['huggingface', 'modelscope']
}

/**
 * Direct download URL for `<repo>/<file>` on a given mirror, e.g.
 * `https://huggingface.co/PaddlePaddle/PP-OCRv6_medium_det_onnx/resolve/main/inference.onnx`.
 */
export function resolveModelFileUrl(id: ModelSourceId, repo: string, file: string): string {
  const source = SOURCES[id]
  const repoPath = source.remotePathTemplate.replace('{model}', repo).replace('{revision}', source.revision)
  return `${source.remoteHost}/${repoPath}/${file}`
}
