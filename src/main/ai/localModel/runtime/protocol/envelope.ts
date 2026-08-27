import type { ProxyRoutingSnapshot } from '@main/services/proxy/proxyRouting'

import type { EmbeddingCountTokensMessage, EmbeddingEmbedMessage, EmbeddingPayloads } from './embedding'
import type { OcrPayloads, OcrRecognizeMessage } from './ocr'

/**
 * Process-agnostic message protocol for the inference host, and the one place the
 * capabilities are unioned together.
 *
 * The host currently runs a `worker_threads` worker (see `../InferenceServiceBase`), but
 * both sides exchange only structured-clone-safe values, so the exact same protocol works
 * unchanged when the host later moves to an Electron `utilityProcess` for crash isolation.
 * Keep it free of class instances, functions, and Electron types.
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
  /** App root, used by the worker to resolve its inference packages. */
  appPath: string
  /** Absolute path to the downloaded onnxruntime-node native binding — set as
   * `CHERRY_ONNXRUNTIME_BINDING_PATH` in the worker's own env before its first lazy
   * require of `@huggingface/transformers`/`ppu-paddle-ocr` (see the onnxruntime-node
   * shared artifact in `ai/localModel`). */
  onnxRuntimeBindingPath: string
  /** Platform-resolved runtime configuration for every capability. */
  runtimeProfile: LocalInferenceRuntimeProfile
  /** ProxyService-owned routing decision; the worker never parses proxy or bypass config. */
  proxyRouting: ProxyRoutingSnapshot
}

/** Every request the worker accepts. One member per capability request message. */
export type InferenceRequest = EmbeddingEmbedMessage | EmbeddingCountTokensMessage | OcrRecognizeMessage

export type InferenceRequestType = InferenceRequest['type']

/**
 * What each request type answers with. Keyed by request type rather than merged into one
 * result struct of optional fields: a caller then gets exactly its own payload, statically,
 * and a new capability cannot widen what every other capability sees.
 */
export type InferenceResultPayloads = EmbeddingPayloads & OcrPayloads

/**
 * The payload keys each request type promises. The host checks them on arrival, so a worker
 * handler that forgets one fails the request instead of resolving a caller with `undefined`
 * where it declared a value — an empty embedding indexed as a real one is silent and
 * unrecoverable.
 */
export const INFERENCE_RESULT_KEYS = {
  'embedding.embed': ['embeddings'],
  'embedding.countTokens': ['tokenCounts'],
  'ocr.recognize': ['text', 'lines']
} as const satisfies Record<InferenceRequestType, readonly string[]>

// -- worker → main --------------------------------------------------------

/** Worker-side log line, surfaced through the main-process logger. */
export interface InferenceLogMessage {
  type: 'log'
  level: 'info' | 'warn' | 'error'
  message: string
}

/** Successful completion of request `id`; `payload` is that request type's own shape. */
export interface InferenceResultMessage {
  type: 'result'
  id: string
  payload: InferenceResultPayloads[InferenceRequestType]
}

export interface InferenceErrorMessage {
  type: 'error'
  id: string
  message: string
}

export type InferenceResponse = InferenceLogMessage | InferenceResultMessage | InferenceErrorMessage
