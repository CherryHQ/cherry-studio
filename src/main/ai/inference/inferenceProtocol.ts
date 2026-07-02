/**
 * Process-agnostic message protocol for the inference host.
 *
 * The host currently runs a `worker_threads` worker (see `InferenceHost`), but
 * both sides exchange only structured-clone-safe values, so the exact same
 * protocol works unchanged when the host later moves to an Electron
 * `utilityProcess` for crash isolation. Keep it free of class instances,
 * functions, and Electron types.
 */

/** Where transformers.js fetches ONNX weights from (HF / mirror / ModelScope). */
export interface InferenceModelSource {
  /** transformers.js `env.remoteHost`, e.g. `https://huggingface.co`. */
  remoteHost: string
  /** transformers.js `env.remotePathTemplate`, e.g. `{model}/resolve/{revision}`. */
  remotePathTemplate: string
  /** Branch/tag — `main` on HuggingFace, `master` on ModelScope. */
  revision: string
}

// -- main → worker --------------------------------------------------------

/** One-time setup sent right after the worker spawns. */
export interface InferenceInitMessage {
  type: 'init'
  /** transformers.js cache dir (resolved from an Electron path in the main process). */
  cacheDir: string
  /** App root, used by the worker to resolve `@huggingface/transformers`. */
  appPath: string
}

/** Load (downloading if absent) the embedding pipeline; emits progress. */
export interface EmbeddingLoadMessage {
  type: 'embedding.load'
  id: string
  modelRepo: string
  dtype: string
  source: InferenceModelSource
}

/** Embed texts; loads the pipeline first if it is not cached yet. */
export interface EmbeddingEmbedMessage {
  type: 'embedding.embed'
  id: string
  modelRepo: string
  dtype: string
  source: InferenceModelSource
  texts: string[]
}

/** Absolute paths to the PaddleOCR model files (downloaded by the main process). */
export interface OcrModelPaths {
  detection: string
  recognition: string
  charactersDictionary: string
}

/** Recognize text in an image file; loads the PaddleOCR pipeline first if needed. */
export interface OcrRecognizeMessage {
  type: 'ocr.recognize'
  id: string
  modelPaths: OcrModelPaths
  /** Absolute path to the image file; the worker reads it into a buffer. */
  imagePath: string
}

export type InferenceRequest = EmbeddingLoadMessage | EmbeddingEmbedMessage | OcrRecognizeMessage

// -- worker → main --------------------------------------------------------

/** Download/load progress for the in-flight request `id`. */
export interface InferenceProgressMessage {
  type: 'progress'
  id: string
  /** transformers.js status: `initiate` | `download` | `progress` | `done` | `ready`. */
  status: string
  file?: string
  loaded?: number
  total?: number
  /** 0–100. */
  progress?: number
}

/** Worker-side log line, surfaced through the main-process logger. */
export interface InferenceLogMessage {
  type: 'log'
  level: 'info' | 'warn' | 'error'
  message: string
}

/** Successful completion. Only the field for the request kind is set. */
export interface InferenceResultMessage {
  type: 'result'
  id: string
  /** Embedding vectors (`embedding.embed`); null for a pure `embedding.load`. */
  embeddings?: number[][] | null
  /** Recognized text (`ocr.recognize`). */
  text?: string | null
}

export interface InferenceErrorMessage {
  type: 'error'
  id: string
  message: string
}

export type InferenceResponse =
  | InferenceProgressMessage
  | InferenceLogMessage
  | InferenceResultMessage
  | InferenceErrorMessage
