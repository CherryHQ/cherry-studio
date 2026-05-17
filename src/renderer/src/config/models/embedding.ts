import type { Model } from '@shared/data/types/model'
import { isEmbeddingModel as sharedIsEmbeddingModel, isRerankModel as sharedIsRerankModel } from '@shared/utils/model'

/**
 * Embedding-model check. Reads shared's `EMBEDDING` capability. v2
 * `Model.capabilities` is authoritative (registry inference + baked-in user
 * overrides merged by `ModelService`).
 */
export function isEmbeddingModel(model: Model): boolean {
  if (!model) return false
  return sharedIsEmbeddingModel(model)
}

/**
 * Reranker check. Reads shared's `RERANK` capability.
 */
export function isRerankModel(model: Model): boolean {
  if (!model) return false
  return sharedIsRerankModel(model)
}
