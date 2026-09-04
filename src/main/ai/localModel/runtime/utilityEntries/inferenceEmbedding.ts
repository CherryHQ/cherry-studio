/**
 * Embedding inference entry (transformers.js / Qwen3-Embedding), one process per app.
 */

import type { EmbeddingInferenceContract } from '@main/ai/localModel/runtime/inferenceProcess'
import type { InferenceInitData } from '@main/ai/localModel/runtime/protocol'
import { serveUtilityProcess } from '@main/core/utilityProcess/runtime/serveUtilityProcess'

import { embeddingHandlers } from './inferenceEmbeddingHandlers'
import { applyInitData, disposeCachedResources } from './inferenceRuntime'

serveUtilityProcess<EmbeddingInferenceContract, InferenceInitData>({
  id: 'inference.embedding',
  initialize: (initData) => applyInitData(initData),
  handlers: embeddingHandlers,
  dispose: ({ logger }) => disposeCachedResources(logger)
})
