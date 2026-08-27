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
  /** App root, used by the worker to resolve `@huggingface/transformers`. */
  appPath: string
  /** Absolute path to the downloaded onnxruntime-node native binding — set as
   * `CHERRY_ONNXRUNTIME_BINDING_PATH` in the worker's own env before its first lazy
   * require of `@huggingface/transformers`/`ppu-paddle-ocr` (see the onnxruntime-node
   * shared artifact in `ai/localModel`). */
  onnxRuntimeBindingPath: string
  /** Platform-resolved runtime configuration for embedding and OCR. */
  runtimeProfile: LocalInferenceRuntimeProfile
  /** ProxyService-owned routing decision; the worker never parses proxy or bypass config. */
  proxyRouting: ProxyRoutingSnapshot
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

/** One recognized text run with its box in the source image's pixel space. */
export interface OcrLine {
  text: string
  box: { x: number; y: number; width: number; height: number }
  confidence: number
}

/**
 * Where the image comes from. A discriminated union, not two optional fields:
 * the latter would let `{}` and `{ imagePath, imageBytes }` typecheck, pushing
 * the "exactly one" rule into a runtime check nobody remembers to write.
 */
export type OcrRecognizeSource = { kind: 'path'; imagePath: string } | { kind: 'bytes'; imageBytes: Uint8Array }

/** Recognize text in an image; `bytes` exists so in-memory captures never touch disk. */
export interface OcrRecognizeMessage {
  type: 'ocr.recognize'
  id: string
  modelPaths: OcrModelPaths
  source: OcrRecognizeSource
}

export type InferenceRequest = EmbeddingEmbedMessage | EmbeddingCountTokensMessage | OcrRecognizeMessage

// -- worker → main --------------------------------------------------------

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
  /** Embedding vectors (`embedding.embed`). */
  embeddings?: number[][] | null
  /** Recognized text (`ocr.recognize`). */
  text?: string | null
  /** Recognized runs with their boxes (`ocr.recognize`), grouped as the engine grouped them. */
  lines?: OcrLine[][] | null
  /** Token counts, one per input text (`embedding.countTokens`). */
  tokenCounts?: number[] | null
}

export interface InferenceErrorMessage {
  type: 'error'
  id: string
  message: string
}

export type InferenceResponse = InferenceLogMessage | InferenceResultMessage | InferenceErrorMessage
