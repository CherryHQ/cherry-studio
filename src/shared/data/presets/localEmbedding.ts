import { createUniqueModelId } from '@shared/data/types/model'

/**
 * Optional, local, in-process text embedding provider (transformers.js +
 * onnxruntime-node). Coexists with the remote-provider embedding route — it is
 * NOT a replacement. Registered as a hidden AI provider/model so the knowledge
 * base can select it while it stays out of the general model lists.
 *
 * Runtime model details (HF repo, dtype, runtime device) live in the main
 * process engine (`src/main/ai/provider/custom/localEmbedding`), not here —
 * this module only holds the cross-process identity constants shared by the
 * seeder, the provider extension, and renderer predicates.
 */
export const LOCAL_EMBEDDING_PROVIDER_ID = 'local-embedding' as const
export const LOCAL_EMBEDDING_PROVIDER_NAME = 'Local Embedding' as const

/** modelId registered in `user_model` — must not contain reserved routing chars (`?` / `#`). */
export const LOCAL_EMBEDDING_MODEL_ID = 'qwen3-embedding-0.6b' as const
export const LOCAL_EMBEDDING_MODEL_NAME = 'Qwen3 Embedding 0.6B (Local)' as const
export const LOCAL_EMBEDDING_MODEL_GROUP = 'Qwen' as const

/** Output vector size of Qwen3-Embedding-0.6B; used when wiring a base to this model. */
export const LOCAL_EMBEDDING_DIMENSIONS = 1024 as const

/** PK for the seeded `user_model` row (`local-embedding::qwen3-embedding-0.6b`). */
export const LOCAL_EMBEDDING_UNIQUE_MODEL_ID = createUniqueModelId(
  LOCAL_EMBEDDING_PROVIDER_ID,
  LOCAL_EMBEDDING_MODEL_ID
)

export function isLocalEmbeddingProviderId(providerId: string): boolean {
  return providerId === LOCAL_EMBEDDING_PROVIDER_ID
}

/** Download/availability state of a local model, shared by the settings model cards. */
export const LOCAL_MODEL_STATUSES = ['not_downloaded', 'downloading', 'ready', 'error'] as const
export type LocalModelStatus = (typeof LOCAL_MODEL_STATUSES)[number]

/** Which downloadable local model a settings card / IPC route targets. */
export const LOCAL_MODEL_KINDS = ['embedding', 'ocr'] as const
export type LocalModelKind = (typeof LOCAL_MODEL_KINDS)[number]
