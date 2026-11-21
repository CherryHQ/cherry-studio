import { createUniqueModelId } from '@shared/data/types/model'

import type { LocalModelBundleId } from './localModel'

/**
 * Optional, local, in-process text embedding provider (transformers.js +
 * onnxruntime-node). Coexists with the remote-provider embedding route — it is
 * NOT a replacement. Seeded as a built-in AI provider/model so the knowledge
 * base can offer it before its weights have been downloaded.
 *
 * Runtime model details (HF repo, dtype, runtime device) live in the main
 * process engine (`src/main/ai/provider/custom/localEmbedding`), not here —
 * this module only holds the cross-process identity constants for the local
 * embedding provider/model, shared between the main-process seeder and
 * the renderer's embedding-dimensions hook.
 */
export const LOCAL_EMBEDDING_PROVIDER_ID = 'local-embedding' as const
export const LOCAL_EMBEDDING_PROVIDER_NAME = 'Local Models' as const

/** modelId registered in `user_model` — must not contain reserved routing chars (`?` / `#`). */
export const LOCAL_EMBEDDING_MODEL_ID = 'qwen3-embedding-0.6b' as const
export const LOCAL_EMBEDDING_MODEL_NAME = 'Qwen3 Embedding 0.6B' as const
export const LOCAL_EMBEDDING_MODEL_GROUP = 'Qwen' as const

/** Output vector size of Qwen3-Embedding-0.6B; used when wiring a base to this model. */
export const LOCAL_EMBEDDING_DIMENSIONS = 1024 as const

/** PK for the seeded `user_model` row (`local-embedding::qwen3-embedding-0.6b`). */
export const LOCAL_EMBEDDING_UNIQUE_MODEL_ID = createUniqueModelId(
  LOCAL_EMBEDDING_PROVIDER_ID,
  LOCAL_EMBEDDING_MODEL_ID
)

/** Lighter builtin local embedding model for lower-end hardware (270M params, 640 dims). */
export const HARRIER_EMBEDDING_MODEL_ID = 'harrier-oss-v1-270m' as const
export const HARRIER_EMBEDDING_MODEL_NAME = 'Harrier 270M' as const
export const HARRIER_EMBEDDING_MODEL_GROUP = 'Microsoft' as const

/** Output vector size of Harrier OSS v1 270M; used when wiring a base to this model. */
export const HARRIER_EMBEDDING_DIMENSIONS = 640 as const

/** PK for the seeded `user_model` row (`local-embedding::harrier-oss-v1-270m`). */
export const HARRIER_EMBEDDING_UNIQUE_MODEL_ID = createUniqueModelId(
  LOCAL_EMBEDDING_PROVIDER_ID,
  HARRIER_EMBEDDING_MODEL_ID
)

export interface LocalEmbeddingModelPreset {
  /** modelId registered in `user_model` under the local-embedding provider. */
  modelId: string
  name: string
  group: string
  /** Output vector size; used when wiring a knowledge base to this model. */
  dimensions: number
  /** Installable bundle id in `LOCAL_MODEL_BUNDLE_IDS`. */
  bundleId: LocalModelBundleId
  uniqueModelId: string
  /** i18n key for the download dialog description (model name + download size). */
  downloadDescriptionKey: string
}

/** Every builtin local embedding model: Qwen stays the default for existing users. */
export const LOCAL_EMBEDDING_MODELS = [
  {
    modelId: LOCAL_EMBEDDING_MODEL_ID,
    name: LOCAL_EMBEDDING_MODEL_NAME,
    group: LOCAL_EMBEDDING_MODEL_GROUP,
    dimensions: LOCAL_EMBEDDING_DIMENSIONS,
    bundleId: 'qwen3-embedding-0.6b',
    uniqueModelId: LOCAL_EMBEDDING_UNIQUE_MODEL_ID,
    downloadDescriptionKey: 'settings.dependencies.localModels.embedding.subtitle'
  },
  {
    modelId: HARRIER_EMBEDDING_MODEL_ID,
    name: HARRIER_EMBEDDING_MODEL_NAME,
    group: HARRIER_EMBEDDING_MODEL_GROUP,
    dimensions: HARRIER_EMBEDDING_DIMENSIONS,
    bundleId: 'harrier-oss-v1-270m',
    uniqueModelId: HARRIER_EMBEDDING_UNIQUE_MODEL_ID,
    downloadDescriptionKey: 'settings.dependencies.localModels.harrier.subtitle'
  }
] as const satisfies readonly LocalEmbeddingModelPreset[]

export const LOCAL_EMBEDDING_UNIQUE_MODEL_IDS: readonly string[] = LOCAL_EMBEDDING_MODELS.map(
  (model) => model.uniqueModelId
)

export function isLocalEmbeddingModel(uniqueModelId: string): boolean {
  return LOCAL_EMBEDDING_UNIQUE_MODEL_IDS.includes(uniqueModelId)
}

export function getLocalEmbeddingDimensions(uniqueModelId: string): number | undefined {
  return LOCAL_EMBEDDING_MODELS.find((model) => model.uniqueModelId === uniqueModelId)?.dimensions
}

/** Bundle id for a local-embedding provider modelId (e.g. from `LocalEmbeddingModel.modelId`). */
export function localEmbeddingBundleIdForModelId(modelId: string): LocalEmbeddingModelPreset['bundleId'] | undefined {
  return LOCAL_EMBEDDING_MODELS.find((model) => model.modelId === modelId)?.bundleId
}

/** Preset for an installable embedding bundle id. */
export function localEmbeddingPresetForBundleId(bundleId: string): LocalEmbeddingModelPreset | undefined {
  return LOCAL_EMBEDDING_MODELS.find((model) => model.bundleId === bundleId)
}

/** Bundle id for a `local-embedding::<model>` unique model id (e.g. a knowledge base's `embeddingModelId`). */
export function localEmbeddingBundleIdForUniqueModelId(
  uniqueModelId: string
): LocalEmbeddingModelPreset['bundleId'] | undefined {
  return LOCAL_EMBEDDING_MODELS.find((model) => model.uniqueModelId === uniqueModelId)?.bundleId
}
