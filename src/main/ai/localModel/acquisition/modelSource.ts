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
 * China defaults to ModelScope (HuggingFace is hard to reach in China). `inChina` is the
 * egress-IP-based signal from `regionService.isInChina()` — the same one BinaryManager uses
 * to pick binary download mirrors — not the app's display locale, which reflects language
 * preference rather than network reachability.
 */
export function defaultModelSourceId(inChina: boolean): ModelSourceId {
  return inChina ? 'modelscope' : 'huggingface'
}

/** A permutation of {@link ALL_MODEL_SOURCE_IDS}: the region default first, the other as fallback. */
export function modelSourceOrder(inChina: boolean): [ModelSourceId, ...ModelSourceId[]] {
  return defaultModelSourceId(inChina) === 'modelscope' ? ['modelscope', 'huggingface'] : ['huggingface', 'modelscope']
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
