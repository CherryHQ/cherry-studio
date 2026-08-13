import type { ProxyRoutingSnapshot } from '@main/services/proxy/proxyRouting'

/**
 * Process-agnostic message protocol for the inference host.
 *
 * The host currently runs a `worker_threads` worker (see `InferenceServiceBase`), but
 * both sides exchange only structured-clone-safe values, so the exact same
 * protocol works unchanged when the host later moves to an Electron
 * `utilityProcess` for crash isolation. Keep it free of class instances,
 * functions, and Electron types.
 */

/** Where transformers.js downloads ONNX weights from (HuggingFace / ModelScope mirror).
 * Download only — inference resolves the cached model by absolute path instead. */
export interface InferenceModelSource {
  /** transformers.js `env.remoteHost`, e.g. `https://huggingface.co`. */
  remoteHost: string
  /** transformers.js `env.remotePathTemplate`, e.g. `{model}/resolve/{revision}`. */
  remotePathTemplate: string
  /** Branch/tag — `main` on HuggingFace, `master` on ModelScope. */
  revision: string
}

export type LocalInferenceProfileId = 'cpu' | 'directml' | 'coreml'
export type LocalInferenceDevice = 'cpu' | 'dml' | 'coreml'
export type LocalInferenceExecutionProvider = 'cpu' | 'dml' | 'coreml' | { name: 'coreml'; coreMlFlags: number }

export interface LocalInferenceSessionOptions {
  executionProviders: LocalInferenceExecutionProvider[]
  enableMemPattern?: boolean
  executionMode?: 'sequential'
}

/** Runtime options resolved in the main process for the worker's two inference backends. */
export interface LocalInferenceRuntimeProfile {
  id: LocalInferenceProfileId
  /** transformers.js device selector. */
  transformersDevice: LocalInferenceDevice
  /** ppu-paddle-ocr options and the default transformers.js session options. */
  sessionOptions: LocalInferenceSessionOptions
  /** transformers.js override; defaults to {@link sessionOptions} when absent. */
  embeddingSessionOptions?: LocalInferenceSessionOptions
}

// -- main → worker --------------------------------------------------------

/** One-time setup sent right after the worker spawns. */
export interface InferenceInitMessage {
  type: 'init'
  /** transformers.js cache dir (resolved from an Electron path in the main process). */
  cacheDir?: string
  /** App root, used by the worker to resolve `@huggingface/transformers`. */
  appPath: string
  /** Absolute path to the downloaded onnxruntime-node native binding — set as
   * `CHERRY_ONNXRUNTIME_BINDING_PATH` in the worker's own env before its first lazy
   * require of `@huggingface/transformers`/`ppu-paddle-ocr` (see OnnxRuntimeBinaryService). */
  onnxRuntimeBindingPath: string
  /** Platform-resolved runtime configuration for embedding and OCR. */
  runtimeProfile: LocalInferenceRuntimeProfile
  /** ProxyService-owned routing decision; the worker never parses proxy or bypass config. */
  proxyRouting: ProxyRoutingSnapshot
}

/** Load (downloading if absent) the embedding pipeline; emits progress. */
export interface EmbeddingLoadMessage {
  type: 'embedding.load'
  id: string
  modelRepo: string
  dtype: string
  source: InferenceModelSource
}

/**
 * Absolute path to the cached embedding model — the directory holding `config.json`
 * (i.e. transformers.js's revision-specific cache dir, which nests a `master/` segment
 * for ModelScope but not for HuggingFace's `main`). The main process resolves it from
 * its own on-disk probe, exactly as it does for {@link OcrModelPaths}.
 *
 * Passing a path rather than a repo id is what keeps inference offline: transformers.js
 * classifies it via `isValidHfModelId`, and every remote branch in its resolver is
 * gated on that being true, so file discovery can only read the local filesystem.
 */
export type EmbeddingModelDir = string

/** Embed texts; loads the pipeline from local files if it is not cached in memory. */
export interface EmbeddingEmbedMessage {
  type: 'embedding.embed'
  id: string
  modelDir: EmbeddingModelDir
  dtype: string
  texts: string[]
}

/** Count tokens via the pipeline's own tokenizer; loads the pipeline from local files if
 * it is not cached in memory. Keeps token counting off the main process, which must
 * never import `@huggingface/transformers` itself (see localEmbeddingTokenLimit.ts). */
export interface EmbeddingCountTokensMessage {
  type: 'embedding.countTokens'
  id: string
  modelDir: EmbeddingModelDir
  dtype: string
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

export type InferenceRequest =
  | EmbeddingLoadMessage
  | EmbeddingEmbedMessage
  | EmbeddingCountTokensMessage
  | OcrRecognizeMessage

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
  /** Token counts, one per input text (`embedding.countTokens`). */
  tokenCounts?: number[] | null
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
